import { createHmac, timingSafeEqual } from "node:crypto";
import { accountRecord, accountUuid } from "../account/validation";
import { accountRpc } from "./account-db";

export class InvalidResendWebhook extends Error {
  constructor() {
    super("Invalid webhook.");
    this.name = "InvalidResendWebhook";
  }
}
/** Official Svix HMAC scheme over the unchanged raw bytes, with a five-minute replay window. */
export function verifyResendWebhook(
  raw: Buffer,
  headers: Headers,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): unknown {
  const id = headers.get("svix-id"),
    timestamp = headers.get("svix-timestamp"),
    signature = headers.get("svix-signature");
  if (
    raw.byteLength > 64_000 ||
    !id ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(id) ||
    !timestamp ||
    !/^\d{1,12}$/.test(timestamp) ||
    Math.abs(Number(timestamp) - nowSeconds) > 300 ||
    !signature ||
    signature.length > 2000 ||
    !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)
  )
    throw new InvalidResendWebhook();
  const key = Buffer.from(secret.slice(6), "base64");
  if (key.length < 16 || key.length > 128) throw new InvalidResendWebhook();
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.`)
    .update(raw)
    .digest();
  let matched = false;
  for (const item of signature.split(" ")) {
    const [version, value] = item.split(",");
    if (version !== "v1" || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
      continue;
    const supplied = Buffer.from(value, "base64");
    if (supplied.length === expected.length)
      matched = timingSafeEqual(supplied, expected) || matched;
  }
  if (!matched) throw new InvalidResendWebhook();
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new InvalidResendWebhook();
  }
}
export async function boundedWebhookBody(request: Request): Promise<Buffer> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 64000))
    throw new InvalidResendWebhook();
  const reader = request.body?.getReader();
  if (!reader) throw new InvalidResendWebhook();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64000) throw new InvalidResendWebhook();
      parts.push(value);
    }
    return Buffer.concat(parts);
  } finally {
    await reader.cancel().catch(() => {});
  }
}
const EVENTS = [
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.delivery_delayed",
  "email.suppressed",
];
export async function ingestResendWebhook(
  payload: unknown,
  eventId: string,
  hashSecret: string,
  rpc: typeof accountRpc = accountRpc,
): Promise<void> {
  if (
    !accountRecord(payload) ||
    typeof payload.type !== "string" ||
    !EVENTS.includes(payload.type)
  )
    return;
  if (
    !accountRecord(payload.data) ||
    !accountRecord(payload.data.tags) ||
    (!accountUuid(payload.data.tags.pearl_grader_report) &&
      !accountUuid(payload.data.tags.pearl_grader_nurture) &&
      !accountUuid(payload.data.tags.pearl_grader_reporting))
  )
    return;
  const data = payload.data;
  const tags = data.tags as Record<string, unknown>;
  // Ambiguous application tags are rejected rather than assigning one provider message to two outboxes.
  if (
    [
      tags.pearl_grader_report,
      tags.pearl_grader_nurture,
      tags.pearl_grader_reporting,
    ].filter(accountUuid).length > 1
  )
    throw new InvalidResendWebhook();
  if (
    !accountUuid(data.email_id) ||
    !Array.isArray(data.to) ||
    data.to.length !== 1 ||
    typeof data.to[0] !== "string" ||
    data.to[0].length > 254 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(data.to[0]) ||
    typeof payload.created_at !== "string" ||
    !Number.isFinite(Date.parse(payload.created_at)) ||
    hashSecret.length < 32
  )
    throw new InvalidResendWebhook();
  const recipientHash = createHmac("sha256", hashSecret)
    .update(`report-email-recipient:${data.to[0].toLowerCase()}`)
    .digest("hex");
  const nurture = accountUuid(tags.pearl_grader_nurture);
  const reporting = accountUuid(tags.pearl_grader_reporting);
  await rpc(
    reporting
      ? "grader_record_reporting_event"
      : nurture
        ? "grader_record_nurture_event"
        : "grader_record_report_email_event",
    {
      p_event_id: eventId,
      p_outbox_id: reporting
        ? tags.pearl_grader_reporting
        : nurture
          ? tags.pearl_grader_nurture
          : tags.pearl_grader_report,
      p_provider_id: data.email_id,
      p_event_type: payload.type,
      p_occurred_at: payload.created_at,
      p_recipient_hash: recipientHash,
    },
  );
}
