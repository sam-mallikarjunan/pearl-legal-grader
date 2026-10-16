import test from "node:test";
import assert from "node:assert/strict";
import {
  guardAccountMutation,
  isAdminEmail,
  normalizeAccountEmail,
  AccountAuthError,
} from "./account-auth";
import { sendAccountCode } from "./auth-email";

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
    RESEND_API_KEY: "re_fixture-not-a-real-credential",
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
    if (url === "https://api.resend.com/emails")
      return Response.json({ id: "fixture-email" });
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
