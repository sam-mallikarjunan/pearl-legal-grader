import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import {
  boundedWebhookBody,
  ingestResendWebhook,
  InvalidResendWebhook,
  verifyResendWebhook,
} from "./resend-webhook";

const secret =
  "whsec_" +
  Buffer.from("synthetic-webhook-key-for-unit-tests").toString("base64");
const now = 1792140000;
function signed(body: Buffer, timestamp = now) {
  const id = "msg_unit_test_fixture";
  const value = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${id}.${timestamp}.`)
    .update(body)
    .digest("base64");
  return new Headers({
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${value}`,
  });
}
test("manual verifier matches the official published Svix reference vector", () => {
  const raw = Buffer.from('{"event_type":"ping","data":{"success":true}}');
  const headers = new Headers({
    "svix-id": "msg_loFOjxBNrRLzqYUf",
    "svix-timestamp": "1731705121",
    "svix-signature": "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
  });
  assert.deepEqual(
    verifyResendWebhook(
      raw,
      headers,
      "whsec_" + "plJ3nmyCDGBKInavdOK15jsl",
      1731705121,
    ),
    { event_type: "ping", data: { success: true } },
  );
});
test("signatures cover the exact raw body, support rotated signatures and reject timestamp replays", () => {
  const raw = Buffer.from('{"type":"email.delivered"}');
  const headers = signed(raw);
  assert.deepEqual(verifyResendWebhook(raw, headers, secret, now), {
    type: "email.delivered",
  });
  headers.set(
    "svix-signature",
    `v1,${Buffer.alloc(32).toString("base64")} ${headers.get("svix-signature")}`,
  );
  assert.deepEqual(verifyResendWebhook(raw, headers, secret, now), {
    type: "email.delivered",
  });
  assert.throws(
    () => verifyResendWebhook(Buffer.from(raw + "\n"), headers, secret, now),
    InvalidResendWebhook,
  );
  assert.throws(
    () => verifyResendWebhook(raw, signed(raw, now - 301), secret, now),
    InvalidResendWebhook,
  );
  assert.throws(
    () => verifyResendWebhook(raw, signed(raw, now + 301), secret, now),
    InvalidResendWebhook,
  );
  headers.set("svix-signature", "v2,unsupported");
  assert.throws(
    () => verifyResendWebhook(raw, headers, secret, now),
    InvalidResendWebhook,
  );
});
test("webhook body is bounded by actual streamed bytes, not just a content-length header", async () => {
  await assert.rejects(
    boundedWebhookBody(
      new Request("https://example.invalid", {
        method: "POST",
        body: "x".repeat(64001),
      }),
    ),
    InvalidResendWebhook,
  );
  await assert.rejects(
    boundedWebhookBody(
      new Request("https://example.invalid", {
        method: "POST",
        headers: { "content-length": "99999" },
        body: "{}",
      }),
    ),
    InvalidResendWebhook,
  );
});
test("only tagged grader events reach storage and raw addresses, subject or webhook bodies never do", async () => {
  const outboxId = "9780410c-1dc0-4b82-a272-b4e3add6a081",
    providerId = "5297ad82-c04a-40c2-92d9-9e4bbf4306e9";
  const calls: Array<Record<string, unknown>> = [];
  const rpc = async (_name: string, args: Record<string, unknown> = {}) => {
    calls.push(args);
    return true;
  };
  const data = {
    email_id: providerId,
    to: ["private@example.invalid"],
    subject: "PRIVATE SUBJECT",
    tags: { pearl_grader_report: outboxId },
  };
  await ingestResendWebhook(
    { type: "email.delivered", created_at: "2026-10-16T16:00:00Z", data },
    "msg_fixture",
    "synthetic-webhook-hash-secret-long-enough",
    rpc,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].p_outbox_id, outboxId);
  assert.match(calls[0].p_recipient_hash as string, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(calls).includes("private@example.invalid"));
  assert.ok(!JSON.stringify(calls).includes("PRIVATE SUBJECT"));
  await ingestResendWebhook(
    {
      type: "email.delivered",
      data: { ...data, tags: { other_application: "yes" } },
    },
    "msg_other",
    "synthetic-webhook-hash-secret-long-enough",
    rpc,
  );
  await ingestResendWebhook(
    { type: "email.opened", data },
    "msg_opened",
    "synthetic-webhook-hash-secret-long-enough",
    rpc,
  );
  assert.equal(calls.length, 1);
});

test("tagged but malformed event recipients and timestamps are rejected before storage", async () => {
  let calls = 0;
  const data = {
    email_id: "5297ad82-c04a-40c2-92d9-9e4bbf4306e9",
    to: ["private@example.invalid"],
    tags: { pearl_grader_report: "9780410c-1dc0-4b82-a272-b4e3add6a081" },
  };
  for (const payload of [
    { type: "email.delivered", created_at: "invalid", data },
    {
      type: "email.delivered",
      created_at: "2026-10-16T16:00:00Z",
      data: {
        ...data,
        to: ["private@example.invalid", "other@example.invalid"],
      },
    },
    {
      type: "email.delivered",
      created_at: "2026-10-16T16:00:00Z",
      data: { ...data, email_id: "wrong-id" },
    },
  ])
    await assert.rejects(
      ingestResendWebhook(
        payload,
        "msg_fixture",
        "synthetic-webhook-hash-secret-long-enough",
        async () => {
          calls++;
          return true;
        },
      ),
      InvalidResendWebhook,
    );
  assert.equal(calls, 0);
});

test("signed nurture events use the dedicated outbox and suppression namespace without storing recipients", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const data = {
    email_id: "5297ad82-c04a-40c2-92d9-9e4bbf4306e9",
    to: ["private@example.invalid"],
    tags: { pearl_grader_nurture: "9780410c-1dc0-4b82-a272-b4e3add6a081" },
  };
  await ingestResendWebhook(
    { type: "email.complained", created_at: "2026-10-19T12:00:00Z", data },
    "msg_nurture_fixture",
    "synthetic-webhook-hash-secret-long-enough",
    async (name, args = {}) => {
      calls.push({ name, args });
      return true;
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "grader_record_nurture_event");
  assert.equal(calls[0].args.p_event_type, "email.complained");
  assert.match(String(calls[0].args.p_recipient_hash), /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(calls).includes("private@example.invalid"));
  await assert.rejects(
    ingestResendWebhook(
      {
        type: "email.delivered",
        created_at: "2026-10-19T12:00:00Z",
        data: {
          ...data,
          tags: {
            ...data.tags,
            pearl_grader_report: "9780410c-1dc0-4b82-a272-b4e3add6a081",
          },
        },
      },
      "msg_ambiguous_fixture",
      "synthetic-webhook-hash-secret-long-enough",
      async () => true,
    ),
    InvalidResendWebhook,
  );
});
