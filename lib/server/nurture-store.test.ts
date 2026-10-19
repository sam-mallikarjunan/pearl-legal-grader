import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import {
  createNurtureService,
  NurtureRetry,
  NurtureUnavailable,
  nurtureConfiguration,
  nurtureRecipientHash,
  parseNurtureEnrollment,
  signNurtureUnsubscribe,
  verifyNurtureUnsubscribe,
  type NurtureConfiguration,
} from "./nurture-store";
import { NURTURE_CONSENT_TEXT, NURTURE_SERIES_VERSION } from "../nurture";

const userId = "9780410c-1dc0-4b82-a272-b4e3add6a081",
  outboxId = "5297ad82-c04a-40c2-92d9-9e4bbf4306e9",
  enrollmentId = "c393002b-670f-44d3-9c23-1a36cdef9669",
  providerId = "f7d85d98-9597-4efa-aa0b-2fb95e6109fe";
const hashSecret = "synthetic-nurture-unit-test-hash-secret";
const configuration: NurtureConfiguration = {
  enabled: true,
  key: "re_synthetic_unit_test_only",
  from: "Pearl <grader@example.invalid>",
  appUrl: "https://example.invalid",
  hashSecret,
  businessName: "Fixture LLC",
  postalAddress: "123 Fixture Road, Fiction, CA 90000",
};
const enrollment = {
  id: enrollmentId,
  status: "active",
  seriesVersion: NURTURE_SERIES_VERSION,
  consentVersion: "practice-foundations-consent-v1",
  enrolledAt: "2026-10-19T10:00:00Z",
  nextSendAt: "2026-10-19T10:00:00Z",
  messagesAccepted: 0,
  messagesDelivered: 0,
  generation: 1,
};
const consent = {
  seriesVersion: NURTURE_SERIES_VERSION,
  consent: true,
  marketingConsent: true,
};
function fixture(
  options: {
    enabled?: boolean;
    recipientChanged?: boolean;
    confirmed?: boolean;
    preflight?: boolean | "paused";
    attempt?: number;
    response?: number;
    throwFetch?: boolean;
    freeze?: boolean;
  } = {},
) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [],
    sent: Array<{ headers: HeadersInit | undefined; body: string }> = [];
  let frozen: unknown = null;
  const service = createNurtureService({
    configuration: () => ({
      ...configuration,
      enabled: options.enabled !== false,
    }),
    readUser: async () => ({
      id: userId,
      email: options.recipientChanged
        ? "changed@example.invalid"
        : "owner@example.invalid",
      confirmed: options.confirmed !== false,
    }),
    rpc: async (name, args = {}) => {
      calls.push({ name, args });
      if (["grader_nurture_state", "grader_enroll_nurture"].includes(name))
        return { paused: false, enrollment };
      if (name === "grader_claim_nurture")
        return {
          id: outboxId,
          enrollmentId,
          generation: 1,
          step: 1,
          revision: 1,
          attempt: options.attempt || 1,
          message: frozen,
          ownerUserId: userId,
          recipientEmail: "owner@example.invalid",
          tokenExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
        };
      if (name === "grader_preflight_nurture") {
        if (options.preflight === false) return null;
        if (options.preflight === "paused") return { paused: true };
        if (!frozen || !options.freeze) frozen = args.p_message;
        return frozen;
      }
      if (name === "grader_reserve_nurture_batch") return [outboxId];
      return true;
    },
    fetch: async (_input, init) => {
      sent.push({ headers: init?.headers, body: String(init?.body) });
      if (options.throwFetch)
        throw new Error("private provider error should not leak");
      return new Response(JSON.stringify({ id: providerId }), {
        status: options.response || 200,
        headers: { "retry-after": "17" },
      });
    },
  });
  return { service, calls, sent };
}
test("configuration fails closed for missing footer, missing key and preview deployment", () => {
  const env = {
    NURTURE_EMAIL_ENABLED: "true",
    RESEND_API_KEY: configuration.key,
    GRADER_EMAIL_FROM: configuration.from,
    SCAN_HASH_SECRET: hashSecret,
    GRADER_BUSINESS_NAME: configuration.businessName,
    GRADER_POSTAL_ADDRESS: configuration.postalAddress,
  };
  assert.equal(nurtureConfiguration(env).enabled, true);
  for (const changed of [
    { GRADER_POSTAL_ADDRESS: "" },
    { GRADER_BUSINESS_NAME: "" },
    { RESEND_API_KEY: "" },
    { VERCEL_ENV: "preview" },
    { NURTURE_EMAIL_ENABLED: "false" },
    { GRADER_POSTAL_ADDRESS: "Your address 123 here" },
    { GRADER_BUSINESS_NAME: "Bad\r\nSender" },
  ])
    assert.equal(nurtureConfiguration({ ...env, ...changed }).enabled, false);
});
test("old preference consent, unchecked series consent and extra fields never enroll", () => {
  for (const input of [
    { marketing: true },
    { ...consent, consent: false },
    { ...consent, marketingConsent: false },
    { ...consent, email: "arbitrary@example.invalid" },
    { ...consent, seriesVersion: "unknown" },
    null,
  ])
    assert.throws(() => parseNurtureEnrollment(input));
  assert.doesNotThrow(() => parseNurtureEnrollment(consent));
});
test("enrollment stores exact new versioned consent and uses only the verified account recipient", async () => {
  const f = fixture();
  const result = await f.service.enroll(
    { id: userId, email: "OWNER@example.invalid" },
    consent,
  );
  assert.equal(result.enrollment?.id, enrollmentId);
  const call = f.calls.find((c) => c.name === "grader_enroll_nurture")!;
  assert.equal(call.args.p_consent_text, NURTURE_CONSENT_TEXT);
  assert.equal(call.args.p_recipient, "owner@example.invalid");
  assert.match(String(call.args.p_recipient_hash), /^[a-f0-9]{64}$/);
  assert.equal(f.sent.length, 0);
});
test("idempotent enroll repeats the same account/series contract without sending duplicate mail", async () => {
  const f = fixture();
  assert.deepEqual(
    await f.service.enroll(
      { id: userId, email: "owner@example.invalid" },
      consent,
    ),
    await f.service.enroll(
      { id: userId, email: "owner@example.invalid" },
      consent,
    ),
  );
  const requests = f.calls.filter((c) => c.name === "grader_enroll_nurture");
  assert.deepEqual(requests[0].args, requests[1].args);
  assert.equal(f.sent.length, 0);
});
test("enrollment fails closed when sending is disabled or the verified recipient changed", async () => {
  await assert.rejects(
    fixture({ enabled: false }).service.enroll(
      { id: userId, email: "owner@example.invalid" },
      consent,
    ),
    NurtureUnavailable,
  );
  for (const f of [
    fixture({ recipientChanged: true }),
    fixture({ confirmed: false }),
  ]) {
    await assert.rejects(
      f.service.enroll({ id: userId, email: "owner@example.invalid" }, consent),
    );
    assert.equal(f.calls.length, 0);
  }
});
test("unsubscribe tokens are purpose-bound, canonical, time-limited and contain no email or API credential", () => {
  const now = 1792400000,
    expiry = now + 90 * 86400;
  const token = signNurtureUnsubscribe(enrollmentId, 1, expiry, hashSecret);
  assert.deepEqual(verifyNurtureUnsubscribe(token, hashSecret, now), {
    id: enrollmentId,
    generation: 1,
  });
  assert.ok(!token.includes("owner") && !token.includes(configuration.key));
  const body = token.split(".").slice(0, -1).join(".");
  const wrongPurpose = `${body}.${createHmac("sha256", hashSecret).update(`report-email:${body}`).digest("base64url")}`;
  for (const tampered of [
    token.replace("n1.", "n1X"),
    token.replace(".1.", ".2."),
    token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"),
    wrongPurpose,
    token + ".extra",
  ])
    assert.throws(() => verifyNurtureUnsubscribe(tampered, hashSecret, now));
  assert.throws(() => verifyNurtureUnsubscribe(token, hashSecret, expiry + 1));
  assert.throws(() =>
    verifyNurtureUnsubscribe(
      token,
      "wrong-secret-but-long-enough-for-validation",
      now,
    ),
  );
});
test("unsubscribe replays are deliberately idempotent and bind storage withdrawal to generation", async () => {
  const f = fixture();
  const token = signNurtureUnsubscribe(
    enrollmentId,
    1,
    Math.floor(Date.now() / 1000) + 86400,
    hashSecret,
  );
  await f.service.unsubscribe(token);
  await f.service.unsubscribe(token);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0], f.calls[1]);
  assert.equal(f.calls[0].args.p_generation, 1);
  assert.equal(f.calls[0].args.p_source, "one_click");
  assert.equal(f.calls[0].args.p_user_id, null);
});
test("fresh account recipient and confirmation are checked again before each provider send", async () => {
  for (const f of [
    fixture({ recipientChanged: true }),
    fixture({ confirmed: false }),
  ]) {
    assert.deepEqual(await f.service.process(outboxId, "run_fixture"), {
      status: "cancelled",
    });
    assert.equal(f.sent.length, 0);
    assert.equal(f.calls.at(-1)?.args.p_error_code, "recipient_changed");
  }
});
test("withdrawal, suppression or pause winning the last database check prevents provider I/O", async () => {
  const f = fixture({ preflight: false });
  assert.deepEqual(await f.service.process(outboxId, "run_fixture"), {
    status: "cancelled",
  });
  assert.equal(f.sent.length, 0);
  assert.equal(f.calls.at(-1)?.args.p_error_code, "consent_or_pause_changed");
});

test("an operator pause preserves untouched work for a later scheduler run without sending", async () => {
  const f = fixture({ preflight: "paused" });
  assert.deepEqual(await f.service.process(outboxId, "run_fixture"), {
    status: "skipped",
  });
  assert.equal(f.sent.length, 0);
  assert.equal(f.calls.at(-1)?.args.p_status, "queued");
  assert.equal(f.calls.at(-1)?.args.p_error_code, "operator_paused");
  const disabled = fixture({ enabled: false });
  assert.deepEqual(await disabled.service.process(outboxId, "run_fixture"), {
    status: "skipped",
  });
  assert.equal(disabled.sent.length, 0);
  assert.equal(
    disabled.calls.at(-1)?.args.p_error_code,
    "configuration_paused",
  );
});
test("successful sending uses frozen curated content, restricted endpoint and stable per-message idempotency", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.process(outboxId, "run_fixture"), {
    status: "accepted",
  });
  assert.equal(f.sent.length, 1);
  const headers = new Headers(f.sent[0].headers);
  assert.equal(headers.get("Idempotency-Key"), `pearl-nurture/${outboxId}`);
  const body = JSON.parse(f.sent[0].body);
  assert.deepEqual(body.to, ["owner@example.invalid"]);
  assert.equal(body.tags[0].value, outboxId);
  assert.equal(
    body.headers["List-Unsubscribe-Post"],
    "List-Unsubscribe=One-Click",
  );
  assert.equal(f.calls.at(-1)?.args.p_provider_id, providerId);
  assert.equal(f.calls.at(-1)?.args.p_status, "accepted");
});
test("ambiguous provider outcomes retry exactly the frozen payload, never use a new idempotency key", async () => {
  const f = fixture({ throwFetch: true, freeze: true });
  await assert.rejects(
    f.service.process(outboxId, "run_fixture"),
    NurtureRetry,
  );
  await assert.rejects(
    f.service.process(outboxId, "run_fixture"),
    NurtureRetry,
  );
  assert.equal(f.sent[0].body, f.sent[1].body);
  assert.deepEqual(f.sent[0].headers, f.sent[1].headers);
  assert.equal(f.calls.at(-1)?.args.p_status, "queued");
});
test("transient rate limits honor bounded Retry-After and four attempts exhaust permanently", async () => {
  const retry = fixture({ response: 429 });
  await assert.rejects(
    retry.service.process(outboxId, "run_fixture"),
    (error: unknown) =>
      error instanceof NurtureRetry && error.retryAfterSeconds === 17,
  );
  const exhausted = fixture({ response: 503, attempt: 4 });
  assert.deepEqual(await exhausted.service.process(outboxId, "run_fixture"), {
    status: "failed",
  });
  assert.equal(exhausted.calls.at(-1)?.args.p_error_code, "retry_exhausted");
  const permanent = fixture({ response: 403 });
  assert.deepEqual(await permanent.service.process(outboxId, "run_fixture"), {
    status: "failed",
  });
  assert.equal(permanent.calls.at(-1)?.args.p_error_code, "provider_rejected");
});
test("cron reserves at most20 opaque job IDs and is a no-op when sending is disabled", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.reserveBatch(), [outboxId]);
  assert.equal(f.calls[0].args.p_limit, 20);
  const disabled = fixture({ enabled: false });
  assert.deepEqual(await disabled.service.reserveBatch(), []);
  assert.equal(disabled.calls.length, 0);
});
test("nurture shares the existing opaque suppression digest but not an unsubscribe signature purpose", () => {
  assert.equal(
    nurtureRecipientHash("OWNER@example.invalid", hashSecret),
    nurtureRecipientHash("owner@example.invalid", hashSecret),
  );
  assert.equal(
    nurtureRecipientHash("owner@example.invalid", hashSecret),
    createHmac("sha256", hashSecret)
      .update("report-email-recipient:owner@example.invalid")
      .digest("hex"),
  );
});
