import { createHmac, timingSafeEqual } from "node:crypto";
import { accountRpc } from "./account-db";
import { accountAdminClient } from "./account-auth";
import { reportEmailConfiguration } from "./report-email";
import {
  AccountDataError,
  accountRecord,
  accountUuid,
} from "../account/validation";
import {
  NURTURE_CONSENT_TEXT,
  NURTURE_CONSENT_VERSION,
  NURTURE_LIMITS,
  NURTURE_SERIES_VERSION,
  renderNurtureEmail,
  type NurtureAccountState,
  type NurtureEnrollment,
  type NurtureMessage,
} from "../nurture";

if (typeof window !== "undefined")
  throw new Error("Nurture email must run on the server.");
const email = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 254 &&
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
export class NurtureUnavailable extends Error {
  readonly code = "nurture_unavailable";
  readonly status = 503;
  constructor() {
    super(
      "The Practice Foundations series is temporarily unavailable. Your dashboard remains available.",
    );
    this.name = "NurtureUnavailable";
  }
}
export class NurtureRetry extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("The same educational email will be retried safely.");
    this.name = "NurtureRetry";
  }
}
export interface NurtureConfiguration {
  enabled: boolean;
  key: string;
  from: string;
  appUrl: string;
  hashSecret: string;
  businessName: string;
  postalAddress: string;
}
export function nurtureConfiguration(
  env: Record<string, string | undefined> = process.env,
): NurtureConfiguration {
  const base = reportEmailConfiguration({
    ...env,
    REPORT_EMAIL_ENABLED: "true",
  });
  const businessName = env.GRADER_BUSINESS_NAME?.trim() || "";
  const postalAddress = env.GRADER_POSTAL_ADDRESS?.trim() || "";
  const validFooter =
    businessName.length >= 2 &&
    businessName.length <= 120 &&
    !/[\r\n\u0000-\u001f]/.test(businessName) &&
    postalAddress.length >= 15 &&
    postalAddress.length <= 1000 &&
    /\d/.test(postalAddress) &&
    !/[\u0000-\u0009\u000b-\u001f]/.test(postalAddress) &&
    !/placeholder|your address|example address|todo/i.test(
      `${businessName} ${postalAddress}`,
    );
  return {
    ...base,
    businessName,
    postalAddress,
    enabled:
      env.NURTURE_EMAIL_ENABLED === "true" &&
      env.VERCEL_ENV !== "preview" &&
      base.enabled &&
      validFooter,
  };
}
export function nurtureRecipientHash(
  recipient: string,
  secret: string,
): string {
  if (!email(recipient) || secret.length < 32) throw new NurtureUnavailable();
  // Shares the established mail-suppression namespace so report-mail complaints stop nurture too.
  return createHmac("sha256", secret)
    .update(`report-email-recipient:${recipient.toLowerCase()}`)
    .digest("hex");
}
export function signNurtureUnsubscribe(
  id: string,
  generation: number,
  expiresAt: number,
  secret: string,
): string {
  if (
    !accountUuid(id) ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    generation > 10000 ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < 1 ||
    secret.length < 32
  )
    throw new NurtureUnavailable();
  const body = `n1.${id}.${generation}.${expiresAt}`;
  const signature = createHmac("sha256", secret)
    .update(`grader-nurture-unsubscribe:v1:${body}`)
    .digest("base64url");
  return `${body}.${signature}`;
}
export function verifyNurtureUnsubscribe(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): { id: string; generation: number } {
  const match =
    /^n1\.([0-9a-f-]{36})\.([1-9][0-9]{0,4})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/.exec(
      token,
    );
  if (!match || !accountUuid(match[1]) || secret.length < 32)
    throw new AccountDataError(
      "invalid_unsubscribe",
      "This unsubscribe link is invalid or expired.",
      400,
    );
  const generation = Number(match[2]),
    expiresAt = Number(match[3]);
  if (generation > 10000 || expiresAt < now || expiresAt > now + 366 * 86400)
    throw new AccountDataError(
      "invalid_unsubscribe",
      "This unsubscribe link is invalid or expired.",
      400,
    );
  const expected = signNurtureUnsubscribe(
    match[1],
    generation,
    expiresAt,
    secret,
  )
    .split(".")
    .at(-1)!;
  const provided = Buffer.from(match[4], "base64url"),
    calculated = Buffer.from(expected, "base64url");
  if (
    provided.toString("base64url") !== match[4] ||
    provided.length !== calculated.length ||
    !timingSafeEqual(provided, calculated)
  )
    throw new AccountDataError(
      "invalid_unsubscribe",
      "This unsubscribe link is invalid or expired.",
      400,
    );
  return { id: match[1], generation };
}
export function parseNurtureEnrollment(value: unknown): void {
  if (
    !accountRecord(value) ||
    Object.keys(value).length !== 3 ||
    value.seriesVersion !== NURTURE_SERIES_VERSION ||
    value.consent !== true ||
    value.marketingConsent !== true
  )
    throw new AccountDataError(
      "invalid_nurture_consent",
      "Choose the unchecked consent option to request this four-email series.",
    );
}
function decodeState(value: unknown, available: boolean): NurtureAccountState {
  if (!accountRecord(value) || typeof value.paused !== "boolean")
    throw new NurtureUnavailable();
  if (value.enrollment === null)
    return { available, paused: value.paused, enrollment: null };
  const e = value.enrollment;
  if (
    !accountRecord(e) ||
    !accountUuid(e.id) ||
    !["active", "withdrawn", "completed", "suppressed"].includes(
      e.status as string,
    ) ||
    e.seriesVersion !== NURTURE_SERIES_VERSION ||
    e.consentVersion !== NURTURE_CONSENT_VERSION ||
    typeof e.enrolledAt !== "string" ||
    !Number.isFinite(Date.parse(e.enrolledAt)) ||
    (e.nextSendAt !== null &&
      (typeof e.nextSendAt !== "string" ||
        !Number.isFinite(Date.parse(e.nextSendAt)))) ||
    !Number.isInteger(e.messagesAccepted) ||
    Number(e.messagesAccepted) < 0 ||
    Number(e.messagesAccepted) > 4 ||
    !Number.isInteger(e.messagesDelivered) ||
    Number(e.messagesDelivered) < 0 ||
    Number(e.messagesDelivered) > 4 ||
    !Number.isInteger(e.generation)
  )
    throw new NurtureUnavailable();
  return {
    available,
    paused: value.paused,
    enrollment: e as unknown as NurtureEnrollment,
  };
}
function rpcError(data: unknown): void {
  if (!accountRecord(data) || typeof data.error !== "string") return;
  const errors: Record<string, [string, number]> = {
    nurture_paused: ["New series enrollment is currently paused.", 409],
    nurture_suppressed: [
      "Educational email is paused for this address after a bounce or complaint.",
      409,
    ],
    nurture_already_started: [
      "This four-part series has already started or stopped. It will not restart automatically.",
      409,
    ],
    revision_conflict: ["These settings changed. Reload and try again.", 409],
    preference_limit: [
      "This account has reached its preference-change allowance.",
      429,
    ],
  };
  const error = errors[data.error];
  if (error) throw new AccountDataError(data.error, error[0], error[1]);
  throw new NurtureUnavailable();
}
interface Dependencies {
  rpc: typeof accountRpc;
  configuration: () => NurtureConfiguration;
  fetch: typeof fetch;
  readUser: (
    id: string,
  ) => Promise<{ id: string; email: string; confirmed: boolean } | null>;
}
function validMessage(
  value: unknown,
  recipient: string,
  id: string,
  c: NurtureConfiguration,
): value is NurtureMessage {
  if (
    !accountRecord(value) ||
    value.from !== c.from ||
    !Array.isArray(value.to) ||
    value.to.length !== 1 ||
    value.to[0] !== recipient ||
    typeof value.subject !== "string" ||
    value.subject.length > 100 ||
    /[\r\n]/.test(value.subject) ||
    typeof value.html !== "string" ||
    typeof value.text !== "string" ||
    !accountRecord(value.headers) ||
    typeof value.headers["List-Unsubscribe"] !== "string" ||
    value.headers["List-Unsubscribe-Post"] !== "List-Unsubscribe=One-Click" ||
    !Array.isArray(value.tags) ||
    value.tags.length !== 1 ||
    !accountRecord(value.tags[0]) ||
    value.tags[0].name !== "pearl_grader_nurture" ||
    value.tags[0].value !== id ||
    Object.keys(value).some(
      (k) =>
        !["from", "to", "subject", "html", "text", "headers", "tags"].includes(
          k,
        ),
    ) ||
    Buffer.byteLength(JSON.stringify(value)) > 50000
  )
    return false;
  return (
    value.headers["List-Unsubscribe"].startsWith(
      `<${c.appUrl}/api/nurture/unsubscribe?token=`,
    ) && value.headers["List-Unsubscribe"].endsWith(">")
  );
}
export function createNurtureService(d: Dependencies) {
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const data = await d.rpc(name, args);
    rpcError(data);
    return data;
  };
  const finish = (
    id: string,
    lease: string,
    revision: number,
    status: string,
    provider: string | null,
    error: string | null,
    retry = 0,
  ) =>
    rpc("grader_finish_nurture", {
      p_outbox_id: id,
      p_lease_id: lease,
      p_revision: revision,
      p_status: status,
      p_provider_id: provider,
      p_error_code: error,
      p_retry_seconds: retry,
    });
  return {
    async read(userId: string): Promise<NurtureAccountState> {
      if (!accountUuid(userId)) throw new NurtureUnavailable();
      return decodeState(
        await rpc("grader_nurture_state", { p_user_id: userId }),
        d.configuration().enabled,
      );
    },
    async enroll(
      user: { id: string; email: string },
      body: unknown,
    ): Promise<NurtureAccountState> {
      parseNurtureEnrollment(body);
      const c = d.configuration();
      if (!c.enabled) throw new NurtureUnavailable();
      const current = await d.readUser(user.id);
      if (
        !accountUuid(user.id) ||
        !email(user.email) ||
        !current?.confirmed ||
        current.id !== user.id ||
        current.email.toLowerCase() !== user.email.toLowerCase()
      )
        throw new AccountDataError(
          "recipient_unverified",
          "Verify your current account email before subscribing.",
          403,
        );
      return decodeState(
        await rpc("grader_enroll_nurture", {
          p_user_id: user.id,
          p_recipient: current.email.toLowerCase(),
          p_recipient_hash: nurtureRecipientHash(current.email, c.hashSecret),
          p_series_version: NURTURE_SERIES_VERSION,
          p_consent_version: NURTURE_CONSENT_VERSION,
          p_consent_text: NURTURE_CONSENT_TEXT,
        }),
        c.enabled,
      );
    },
    async withdraw(userId: string) {
      if (!accountUuid(userId)) throw new NurtureUnavailable();
      await rpc("grader_withdraw_nurture", {
        p_user_id: userId,
        p_enrollment_id: null,
        p_generation: null,
        p_source: "account",
      });
      return this.read(userId);
    },
    async unsubscribe(token: string) {
      const { id, generation } = verifyNurtureUnsubscribe(
        token,
        d.configuration().hashSecret,
      );
      await rpc("grader_withdraw_nurture", {
        p_user_id: null,
        p_enrollment_id: id,
        p_generation: generation,
        p_source: "one_click",
      });
    },
    async reserveBatch(): Promise<string[]> {
      if (!d.configuration().enabled) return [];
      const data = await rpc("grader_reserve_nurture_batch", {
        p_limit: NURTURE_LIMITS.batch,
      });
      if (
        !Array.isArray(data) ||
        data.length > NURTURE_LIMITS.batch ||
        data.some((id) => !accountUuid(id)) ||
        new Set(data).size !== data.length
      )
        throw new NurtureUnavailable();
      return data as string[];
    },
    async recordWorkflow(id: string, runId: string) {
      await rpc("grader_record_nurture_workflow", {
        p_outbox_id: id,
        p_run_id: runId,
      });
    },
    async releaseDispatch(id: string) {
      await rpc("grader_release_nurture_dispatch", { p_outbox_id: id });
    },
    async exportOwn(userId: string): Promise<unknown> {
      if (!accountUuid(userId)) throw new NurtureUnavailable();
      return rpc("grader_export_nurture", { p_user_id: userId });
    },
    async operations() {
      const data = await rpc("grader_nurture_operations");
      if (!accountRecord(data)) throw new NurtureUnavailable();
      return {
        ...data,
        enabled: d.configuration().enabled,
        limits: NURTURE_LIMITS,
        seriesVersion: NURTURE_SERIES_VERSION,
      };
    },
    async setPause(actor: string, value: unknown) {
      if (
        !accountUuid(actor) ||
        !accountRecord(value) ||
        Object.keys(value).length !== 3 ||
        !Number.isInteger(value.revision) ||
        Number(value.revision) < 0 ||
        typeof value.paused !== "boolean" ||
        typeof value.reason !== "string" ||
        value.reason.trim().length < 8 ||
        value.reason.length > 500 ||
        /[\u0000-\u001f]/.test(value.reason)
      )
        throw new AccountDataError(
          "invalid_nurture_pause",
          "Choose pause or resume and add a short reason.",
        );
      await rpc("grader_set_nurture_pause", {
        p_actor: actor,
        p_revision: value.revision,
        p_paused: value.paused,
        p_reason: value.reason.trim(),
      });
      return this.operations();
    },
    async process(
      id: string,
      lease: string,
    ): Promise<{ status: "accepted" | "failed" | "cancelled" | "skipped" }> {
      if (!accountUuid(id) || !lease || lease.length > 200)
        throw new NurtureUnavailable();
      const data = await rpc("grader_claim_nurture", {
        p_outbox_id: id,
        p_lease_id: lease,
      });
      if (data === null) return { status: "skipped" };
      if (
        !accountRecord(data) ||
        data.id !== id ||
        !accountUuid(data.enrollmentId) ||
        !accountUuid(data.ownerUserId) ||
        !email(data.recipientEmail) ||
        !Number.isInteger(data.step) ||
        Number(data.step) < 1 ||
        Number(data.step) > 4 ||
        !Number.isInteger(data.revision) ||
        !Number.isInteger(data.attempt) ||
        Number(data.attempt) < 1 ||
        Number(data.attempt) > 4 ||
        !Number.isInteger(data.generation) ||
        typeof data.tokenExpiresAt !== "string" ||
        !Number.isFinite(Date.parse(data.tokenExpiresAt))
      )
        throw new NurtureUnavailable();
      const revision = Number(data.revision),
        attempt = Number(data.attempt),
        c = d.configuration();
      if (!c.enabled) {
        await finish(
          id,
          lease,
          revision,
          "queued",
          null,
          "configuration_paused",
        );
        return { status: "skipped" };
      }
      const current = await d.readUser(data.ownerUserId as string);
      if (
        !current?.confirmed ||
        current.id !== data.ownerUserId ||
        current.email.toLowerCase() !== data.recipientEmail
      ) {
        await finish(
          id,
          lease,
          revision,
          "cancelled",
          null,
          "recipient_changed",
        );
        return { status: "cancelled" };
      }
      const token = signNurtureUnsubscribe(
        data.enrollmentId as string,
        Number(data.generation),
        Math.floor(Date.parse(data.tokenExpiresAt) / 1000),
        c.hashSecret,
      );
      const fresh = renderNurtureEmail({
        step: Number(data.step),
        recipient: data.recipientEmail,
        outboxId: id,
        unsubscribeUrl: `${c.appUrl}/api/nurture/unsubscribe?token=${token}`,
        ...c,
      });
      const message = await rpc("grader_preflight_nurture", {
        p_outbox_id: id,
        p_lease_id: lease,
        p_revision: revision,
        p_recipient: current.email.toLowerCase(),
        p_message: fresh,
      });
      if (accountRecord(message) && message.paused === true) {
        await finish(id, lease, revision, "queued", null, "operator_paused");
        return { status: "skipped" };
      }
      if (message === null) {
        await finish(
          id,
          lease,
          revision,
          "cancelled",
          null,
          "consent_or_pause_changed",
        );
        return { status: "cancelled" };
      }
      if (!validMessage(message, data.recipientEmail, id, c)) {
        await finish(
          id,
          lease,
          revision,
          "failed",
          null,
          "invalid_frozen_message",
        );
        return { status: "failed" };
      }
      let response: Response | undefined,
        transient = true,
        retry = Math.min(120, 5 * 2 ** (attempt - 1));
      try {
        response = await d.fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${c.key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `pearl-nurture/${id}`,
          },
          body: JSON.stringify(message),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        /* Ambiguous outcomes retry the frozen payload and stable provider idempotency key only. */
      }
      if (response?.ok) {
        let provider: unknown;
        try {
          const raw = await response.text();
          if (Buffer.byteLength(raw) <= 64000) {
            const value: unknown = JSON.parse(raw);
            if (accountRecord(value)) provider = value.id;
          }
        } catch {}
        if (accountUuid(provider)) {
          const saved = await finish(
            id,
            lease,
            revision,
            "accepted",
            provider,
            null,
          );
          return { status: saved === true ? "accepted" : "skipped" };
        }
      } else if (response) {
        transient = response.status === 429 || response.status >= 500;
        const after = response.headers.get("retry-after");
        if (after && /^\d+$/.test(after))
          retry = Math.max(retry, Math.min(300, Number(after)));
        await response.body?.cancel().catch(() => {});
      }
      if (!transient || attempt >= 4) {
        await finish(
          id,
          lease,
          revision,
          "failed",
          null,
          transient ? "retry_exhausted" : "provider_rejected",
        );
        return { status: "failed" };
      }
      const saved = await finish(
        id,
        lease,
        revision,
        "queued",
        null,
        null,
        retry,
      );
      if (saved !== true) return { status: "skipped" };
      throw new NurtureRetry(retry);
    },
    async abort(id: string, lease: string) {
      await rpc("grader_abort_nurture", { p_outbox_id: id, p_lease_id: lease });
    },
    async purge() {
      await rpc("grader_purge_nurture");
    },
  };
}
const configured = () =>
  createNurtureService({
    rpc: accountRpc,
    configuration: nurtureConfiguration,
    fetch,
    readUser: async (id) => {
      const { data, error } =
        await accountAdminClient().auth.admin.getUserById(id);
      if (error) throw new NurtureUnavailable();
      const u = data.user;
      return u?.email
        ? { id: u.id, email: u.email, confirmed: !!u.email_confirmed_at }
        : null;
    },
  });
export const readNurtureEnrollment = (id: string) => configured().read(id);
export const enrollNurture = (
  user: { id: string; email: string },
  value: unknown,
) => configured().enroll(user, value);
export const withdrawNurture = (id: string) => configured().withdraw(id);
export const unsubscribeNurture = (token: string) =>
  configured().unsubscribe(token);
export const reserveNurtureBatch = () => configured().reserveBatch();
export const recordNurtureWorkflow = (id: string, runId: string) =>
  configured().recordWorkflow(id, runId);
export const releaseNurtureDispatch = (id: string) =>
  configured().releaseDispatch(id);
export const processNurtureEmail = (id: string, lease: string) =>
  configured().process(id, lease);
export const abortNurtureEmail = (id: string, lease: string) =>
  configured().abort(id, lease);
export const exportOwnNurture = (id: string) => configured().exportOwn(id);
export const readNurtureOperations = () => configured().operations();
export const setNurturePause = (actor: string, value: unknown) =>
  configured().setPause(actor, value);
export const purgeNurture = () => configured().purge();
