import test from "node:test";
import assert from "node:assert/strict";
import {
  guardAccountMutation,
  isAdminEmail,
  normalizeAccountEmail,
  AccountAuthError,
} from "./account-auth";
import { authEmailFailureDiagnostic, sendAccountCode } from "./auth-email";

test("account mutations reject absent, cross-site and lookalike origins", () => {
  const attempts: Record<string, string>[] = [
    {},
    { origin: "https://grader.example.evil" },
    { origin: "https://grader.example", "sec-fetch-site": "cross-site" },
  ];
  for (const headers of attempts)
    assert.throws(
      () =>
        guardAccountMutation(
          new Request("https://grader.example/api/account/preferences", {
            method: "PATCH",
            headers,
          }),
        ),
      AccountAuthError,
    );
  assert.doesNotThrow(() =>
    guardAccountMutation(
      new Request("https://grader.example/api/account/preferences", {
        method: "PATCH",
        headers: { origin: "https://grader.example" },
      }),
    ),
  );
});
test("operator authorization uses an exact server allowlist and bounded email input", () => {
  const old = process.env.GRADER_ADMIN_EMAILS;
  process.env.GRADER_ADMIN_EMAILS = "owner@example.com";
  try {
    assert.equal(isAdminEmail("OWNER@example.com"), true);
    assert.equal(isAdminEmail("owner@example.com.attacker"), false);
    assert.equal(isAdminEmail("other@example.com"), false);
    assert.equal(
      normalizeAccountEmail(" Owner@Example.com "),
      "owner@example.com",
    );
    assert.equal(normalizeAccountEmail("a\n@evil.example"), null);
    assert.equal(normalizeAccountEmail("x".repeat(300)), null);
  } finally {
    if (old === undefined) delete process.env.GRADER_ADMIN_EMAILS;
    else process.env.GRADER_ADMIN_EMAILS = old;
  }
});
test("sign-in delivery uses an actual generated OTP, a fixed destination and no SMTP handoff", async () => {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "RESEND_API_KEY",
    "GRADER_EMAIL_FROM",
    "GRADER_APP_URL",
  ] as const;
  const old = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  Object.assign(process.env, {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_fixture-not-a-real-credential",
    RESEND_API_KEY: "  re_fixture-not-a-real-credential\n",
    GRADER_EMAIL_FROM: "Fixture <grader@example.com>",
    GRADER_APP_URL: "https://grader.example",
  });
  const original = globalThis.fetch;
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push({ url, body });
    if (url.includes("/auth/v1/admin/generate_link"))
      return Response.json({
        action_link: "https://ignored.example",
        email_otp: "123456",
        hashed_token: "fixture-hash",
        redirect_to: "https://ignored.example",
        verification_type: "magiclink",
        id: "00000000-0000-0000-0000-000000000001",
        email: "owner@example.com",
      });
    if (url === "https://api.resend.com/emails") {
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer re_fixture-not-a-real-credential",
      );
      return Response.json({ id: "fixture-email" });
    }
    throw new Error("Unexpected network request");
  };
  try {
    await sendAccountCode("owner@example.com");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.type, "magiclink");
    assert.deepEqual(calls[1].body.to, ["owner@example.com"]);
    assert.match(String(calls[1].body.text), /123456/);
    assert.match(
      String(calls[1].body.text),
      /https:\/\/grader.example\/account/,
    );
    assert.doesNotMatch(
      JSON.stringify(calls[1].body),
      /fixture-hash|ignored.example|sb_secret/,
    );
  } finally {
    globalThis.fetch = original;
    for (const name of names) {
      if (old[name] === undefined) delete process.env[name];
      else process.env[name] = old[name];
    }
  }
});

test("email failure diagnostics emit only fixed categories and allowlisted machine codes", async () => {
  const privateText =
    "owner@example.invalid re_PRIVATE_TOKEN 123456 private report body";
  const fixtures = [
    [
      { name: "validation_error", message: `Invalid API key ${privateText}` },
      "credentials",
    ],
    [
      {
        name: "validation_error",
        message: `The from address must use a verified domain ${privateText}`,
      },
      "sender",
    ],
    [
      { code: "invalid_idempotent_request", message: privateText },
      "idempotency",
    ],
    [
      { name: "validation_error", message: `Invalid recipient ${privateText}` },
      "recipient",
    ],
    [{ name: "rate_limit_exceeded", message: privateText }, "allowance"],
    [
      {
        name: "validation_error",
        message: `Missing required field ${privateText}`,
      },
      "payload",
    ],
    [{ name: privateText, code: privateText, message: privateText }, "other"],
  ] as const;
  for (const [body, category] of fixtures) {
    const diagnostic = await authEmailFailureDiagnostic(
      Response.json(body, { status: 400 }),
    );
    assert.equal(diagnostic.category, category);
    assert.equal(diagnostic.status, 400);
    const serialized = JSON.stringify(diagnostic);
    for (const secret of [
      "owner@example.invalid",
      "re_PRIVATE_TOKEN",
      "123456",
      "private report body",
    ])
      assert.ok(!serialized.includes(secret));
  }
  assert.deepEqual(
    await authEmailFailureDiagnostic(
      new Response("PRIVATE".repeat(3000), { status: 400 }),
    ),
    { status: 400, category: "other" },
  );
  assert.deepEqual(
    await authEmailFailureDiagnostic(new Response("not JSON", { status: 500 })),
    { status: 500, category: "other" },
  );
});

test("an unnamed unverified-domain error stays a sender issue without exposing its body", async () => {
  const diagnostic = await authEmailFailureDiagnostic(
    Response.json(
      {
        message:
          "The associated domain with your API key is not verified. Please, create a new API key with full access or with a verified domain. owner@example.invalid re_PRIVATE_TOKEN 123456 PRIVATE_BODY",
      },
      { status: 400 },
    ),
  );
  assert.deepEqual(diagnostic, { status: 400, category: "sender" });
  assert.doesNotMatch(
    JSON.stringify(diagnostic),
    /owner@|re_PRIVATE_TOKEN|123456|PRIVATE_BODY|associated domain/,
  );
});

test("a rejected sign-in email logs safe diagnostics and keeps the client error opaque", async () => {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "RESEND_API_KEY",
    "GRADER_EMAIL_FROM",
    "GRADER_APP_URL",
  ] as const;
  const old = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_fixture-only",
    RESEND_API_KEY: "re_fixture-only",
    GRADER_EMAIL_FROM: "Fixture <grader@example.invalid>",
    GRADER_APP_URL: "https://grader.example",
  });
  const originalFetch = globalThis.fetch,
    originalError = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  globalThis.fetch = async (input) =>
    String(input).includes("/auth/v1/admin/generate_link")
      ? Response.json({
          email_otp: "876543",
          hashed_token: "PRIVATE_HASH",
          verification_type: "magiclink",
          id: "00000000-0000-0000-0000-000000000001",
          email: "owner@example.invalid",
        })
      : Response.json(
          {
            name: "validation_error",
            message:
              "Invalid from address owner@example.invalid token re_PRIVATE_SECRET code 876543 PRIVATE_BODY",
          },
          { status: 400 },
        );
  try {
    await assert.rejects(
      sendAccountCode("owner@example.invalid"),
      (error: unknown) =>
        error instanceof AccountAuthError &&
        error.status === 503 &&
        error.message ===
          "The sign-in message could not be requested. Please try again later.",
    );
    assert.deepEqual(logs, [
      [
        "grader_auth_email_provider_failed",
        { status: 400, category: "sender", providerName: "validation_error" },
      ],
    ]);
    assert.doesNotMatch(
      JSON.stringify(logs),
      /owner@|re_PRIVATE_SECRET|876543|PRIVATE_BODY|PRIVATE_HASH/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    for (const name of names) {
      if (old[name] === undefined) delete process.env[name];
      else process.env[name] = old[name];
    }
  }
});
