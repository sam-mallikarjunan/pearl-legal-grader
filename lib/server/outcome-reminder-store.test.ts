import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import {
  createOutcomeReminderStore,
  reportingReminderConfiguration,
  signReportingUnsubscribe,
  verifyReportingUnsubscribe,
  ReportingReminderRetry,
} from "./outcome-reminder-store";
import {
  REPORTING_REMINDER_CONSENT,
  REPORTING_REMINDER_VERSION,
  renderReportingReminder,
} from "../reporting-reminders";
import { ingestResendWebhook, InvalidResendWebhook } from "./resend-webhook";
import {
  GET as unsubscribeGet,
  POST as unsubscribePost,
} from "../../app/api/outcome-reminders/unsubscribe/route";
const owner = "9780410c-1dc0-4b82-a272-b4e3add6a081",
  id = "5297ad82-c04a-40c2-92d9-9e4bbf4306e9",
  pref = "c393002b-670f-44d3-9c23-1a36cdef9669",
  provider = "f7d85d98-9597-4efa-aa0b-2fb95e6109fe",
  secret = "synthetic-reporting-unsubscribe-hash-secret";
const config = {
  enabled: true,
  key: "re_synthetic_fixture_only",
  from: "Pearl <grader@example.invalid>",
  appUrl: "https://example.invalid",
  hashSecret: secret,
  businessName: "Fixture LLC",
  postalAddress: "123 Fixture Road, Fixture CA 90000",
};
function fixture(
  options: {
    changed?: boolean;
    preflight?: "cancel" | "paused";
    http?: number;
    attempt?: number;
    enabled?: boolean;
  } = {},
) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [],
    sent: string[] = [];
  let frozen: unknown;
  return {
    calls,
    sent,
    store: createOutcomeReminderStore({
      configuration: () => ({ ...config, enabled: options.enabled !== false }),
      readUser: async () => ({
        id: owner,
        email: options.changed
          ? "new@example.invalid"
          : "owner@example.invalid",
        confirmed: true,
      }),
      rpc: async (name, args = {}) => {
        calls.push({ name, args });
        if (name === "grader_claim_reporting")
          return {
            id,
            preferenceId: pref,
            kind: "sample",
            generation: 2,
            revision: 1,
            attempt: options.attempt || 1,
            ownerUserId: owner,
            recipientEmail: "owner@example.invalid",
            tokenExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
          };
        if (name === "grader_preflight_reporting") {
          if (options.preflight === "cancel") return null;
          if (options.preflight === "paused") return { paused: true };
          if (!frozen) frozen = args.p_message;
          return frozen;
        }
        if (name === "grader_reserve_reporting")
          return args.p_user_id ? { messageId: id, dispatch: true } : [id];
        if (
          name === "grader_set_reporting_consent" ||
          name === "grader_reporting_state"
        )
          return {
            paused: false,
            preference: {
              id: pref,
              granted: true,
              revision: 1,
              generation: 2,
              version: REPORTING_REMINDER_VERSION,
              updatedAt: new Date().toISOString(),
            },
            messages: [],
          };
        return true;
      },
      fetch: async (_url, init) => {
        sent.push(String(init?.body));
        assert.equal(
          new Headers(init?.headers).get("idempotency-key"),
          `pearl-reporting/${id}`,
        );
        return new Response(JSON.stringify({ id: provider }), {
          status: options.http || 200,
        });
      },
    }),
  };
}
test("fresh reporting flag is independent and preview/missing footer fail closed", () => {
  const env = {
    REPORTING_REMINDERS_ENABLED: "true",
    NURTURE_EMAIL_ENABLED: "false",
    RESEND_API_KEY: config.key,
    GRADER_EMAIL_FROM: config.from,
    SCAN_HASH_SECRET: secret,
    GRADER_BUSINESS_NAME: config.businessName,
    GRADER_POSTAL_ADDRESS: config.postalAddress,
  };
  assert.equal(reportingReminderConfiguration(env).enabled, true);
  for (const extra of [
    { REPORTING_REMINDERS_ENABLED: "false" },
    { VERCEL_ENV: "preview" },
    { GRADER_POSTAL_ADDRESS: "" },
  ])
    assert.equal(
      reportingReminderConfiguration({ ...env, ...extra }).enabled,
      false,
    );
});
test("only explicit fresh reporting consent is accepted, never legacy reminder/marketing switches", async () => {
  const f = fixture();
  await f.store.setConsent(owner, {
    granted: true,
    revision: 0,
    consentVersion: REPORTING_REMINDER_VERSION,
  });
  assert.equal(f.calls[0].args.p_text, REPORTING_REMINDER_CONSENT);
  for (const body of [
    { reminders: true },
    { granted: true, revision: 0, consentVersion: "account-preferences-v1" },
    {
      granted: true,
      revision: 0,
      consentVersion: REPORTING_REMINDER_VERSION,
      email: "arbitrary@example.invalid",
    },
  ])
    await assert.rejects(f.store.setConsent(owner, body));
  assert.equal(f.calls.length, 1);
});
test("signed reminder tokens have a distinct purpose, generation, expiry and canonical separators", () => {
  const now = 1792400000,
    expiry = now + 90 * 86400,
    token = signReportingUnsubscribe(pref, 2, expiry, secret);
  assert.deepEqual(verifyReportingUnsubscribe(token, secret, now), {
    id: pref,
    generation: 2,
  });
  for (const value of [
    token.replace("or1.", "or1X"),
    token.replace(".2.", ".3."),
    token.replace("or1.", "n1."),
    `${token}.extra`,
  ])
    assert.throws(() => verifyReportingUnsubscribe(value, secret, now));
  assert.throws(() => verifyReportingUnsubscribe(token, secret, expiry + 1));
  const body = token.split(".").slice(0, -1).join(".");
  assert.throws(() =>
    verifyReportingUnsubscribe(
      `${body}.${createHmac("sha256", secret).update(`grader-nurture-unsubscribe:v1:${body}`).digest("base64url")}`,
      secret,
      now,
    ),
  );
});
test("unsubscribe calls only the dedicated reminder RPC and is replay safe", async () => {
  const f = fixture(),
    token = signReportingUnsubscribe(
      pref,
      2,
      Math.floor(Date.now() / 1000) + 86400,
      secret,
    );
  await f.store.unsubscribe(token);
  await f.store.unsubscribe(token);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].name, "grader_unsubscribe_reporting");
  assert.deepEqual(f.calls[0], f.calls[1]);
  assert.equal(f.calls[0].args.p_generation, 2);
});
test("sample remains clearly sample while actual reminder contains only period dates", () => {
  const input = {
    ...config,
    recipient: "owner@example.invalid",
    outboxId: id,
    unsubscribeUrl: "https://example.invalid/unsubscribe",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
  };
  const sample = renderReportingReminder({ ...input, kind: "sample" }),
    real = renderReportingReminder({ ...input, kind: "closed" });
  assert.match(sample.subject, /^Sample:/);
  assert.ok(!sample.text.includes("2026-09-01"));
  assert.match(sample.text, /not a notification that a reporting month is due/);
  assert.ok(real.text.includes("2026-09-01 to 2026-09-30"));
  assert.deepEqual(
    real.headers["List-Unsubscribe-Post"],
    "List-Unsubscribe=One-Click",
  );
  assert.ok(
    !/score:|leadSpendMinor|cohortBilled|clientName|Ask Pearl/i.test(real.text),
  );
});
test("recipient changes or final consent/plan/suppression revocation prevent all provider I/O", async () => {
  for (const f of [
    fixture({ changed: true }),
    fixture({ preflight: "cancel" }),
  ]) {
    assert.equal(
      (await f.store.process(id, "run_fixture")).status,
      "cancelled",
    );
    assert.equal(f.sent.length, 0);
  }
  const p = fixture({ preflight: "paused" });
  assert.equal((await p.store.process(id, "run_fixture")).status, "skipped");
  assert.equal(p.calls.at(-1)?.args.p_status, "queued");
  assert.equal(p.sent.length, 0);
});
test("durable retries use frozen payload/key, and4attempts/permanent failures stop", async () => {
  const f = fixture({ http: 503 });
  await assert.rejects(
    f.store.process(id, "run_fixture"),
    ReportingReminderRetry,
  );
  await assert.rejects(
    f.store.process(id, "run_fixture"),
    ReportingReminderRetry,
  );
  assert.equal(f.sent[0], f.sent[1]);
  for (const f of [
    fixture({ http: 503, attempt: 4 }),
    fixture({ http: 403 }),
  ]) {
    assert.equal((await f.store.process(id, "run_fixture")).status, "failed");
    assert.equal(f.calls.at(-1)?.args.p_status, "failed");
  }
  assert.equal(
    (await fixture().store.process(id, "run_fixture")).status,
    "accepted",
  );
});
test("sample accepts no arbitrary recipient and disabled scheduler reserves nothing", async () => {
  const f = fixture();
  await assert.rejects(
    f.store.sample(owner, {
      requestId: id,
      confirm: "SEND SAMPLE REMINDER",
      email: "other@example.invalid",
    }),
  );
  assert.equal(f.calls.length, 0);
  assert.deepEqual(
    await f.store.sample(owner, {
      requestId: id,
      confirm: "SEND SAMPLE REMINDER",
    }),
    { messageId: id, dispatch: true },
  );
  assert.equal(f.calls[0].args.p_user_id, owner);
  assert.equal(f.calls[0].args.p_recipient, "owner@example.invalid");
  const disabled = fixture({ enabled: false });
  assert.deepEqual(await disabled.store.reserve(), []);
  assert.equal(disabled.calls.length, 0);
});
test("three webhook types remain exclusive and malformed reporting event recipients reject", async () => {
  const calls: Array<string> = [];
  const data = {
    email_id: provider,
    to: ["private@example.invalid"],
    tags: { pearl_grader_reporting: id },
  };
  await ingestResendWebhook(
    { type: "email.delivered", created_at: "2026-10-19T16:00:00Z", data },
    "msg_reporting_fixture",
    secret,
    async (name) => {
      calls.push(name);
      return true;
    },
  );
  assert.deepEqual(calls, ["grader_record_reporting_event"]);
  for (const tags of [
    { ...data.tags, pearl_grader_report: id },
    { ...data.tags, pearl_grader_nurture: id },
    { ...data.tags, pearl_grader_report: id, pearl_grader_nurture: id },
  ])
    await assert.rejects(
      ingestResendWebhook(
        {
          type: "email.delivered",
          created_at: "2026-10-19T16:00:00Z",
          data: { ...data, tags },
        },
        "msg_ambiguous",
        secret,
        async () => true,
      ),
      InvalidResendWebhook,
    );
  await assert.rejects(
    ingestResendWebhook(
      {
        type: "email.delivered",
        created_at: "2026-10-19T16:00:00Z",
        data: { ...data, to: ["bad"] },
      },
      "msg_bad",
      secret,
      async () => true,
    ),
    InvalidResendWebhook,
  );
});
test("GET unsubscribe is non-mutating and RFC8058 POST bounds content", async () => {
  const r = await unsubscribeGet(
    new Request(
      "https://example.invalid/api/outcome-reminders/unsubscribe?token=fixture",
    ),
  );
  assert.equal(r.status, 303);
  assert.match(
    r.headers.get("location") || "",
    /\/outcome-reminders\/unsubscribe/,
  );
  assert.equal(
    (
      await unsubscribePost(
        new Request(
          "https://example.invalid/api/outcome-reminders/unsubscribe",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          },
        ),
      )
    ).status,
    400,
  );
});
