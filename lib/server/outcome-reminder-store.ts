import { createHmac, timingSafeEqual } from "node:crypto";
import { accountRpc } from "./account-db";
import { accountAdminClient } from "./account-auth";
import { nurtureConfiguration, nurtureRecipientHash } from "./nurture-store";
import {
  accountRecord,
  accountUuid,
  AccountDataError,
} from "../account/validation";
import {
  REPORTING_REMINDER_CONSENT,
  REPORTING_REMINDER_VERSION,
  REPORTING_REMINDER_LIMITS,
  renderReportingReminder,
  type ReportingReminderState,
} from "../reporting-reminders";
if (typeof window !== "undefined")
  throw new Error("Reporting reminders must run on the server.");
export class ReportingReminderUnavailable extends Error {
  readonly status = 503;
  readonly code = "reporting_reminders_unavailable";
  constructor() {
    super(
      "Outcome-reporting reminders are temporarily unavailable. Your private account remains available.",
    );
    this.name = "ReportingReminderUnavailable";
  }
}
export class ReportingReminderRetry extends Error {
  constructor(public retryAfterSeconds: number) {
    super("The same reporting reminder will retry safely.");
    this.name = "ReportingReminderRetry";
  }
}
export function reportingReminderConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  const c = nurtureConfiguration({ ...env, NURTURE_EMAIL_ENABLED: "true" });
  return {
    ...c,
    enabled: c.enabled && env.REPORTING_REMINDERS_ENABLED === "true",
  };
}
export function signReportingUnsubscribe(
  id: string,
  generation: number,
  expires: number,
  secret: string,
) {
  if (
    !accountUuid(id) ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    generation > 1000000 ||
    !Number.isSafeInteger(expires) ||
    expires < 1 ||
    secret.length < 32
  )
    throw new ReportingReminderUnavailable();
  const body = `or1.${id}.${generation}.${expires}`;
  return `${body}.${createHmac("sha256", secret).update(`grader-reporting-unsubscribe:v1:${body}`).digest("base64url")}`;
}
export function verifyReportingUnsubscribe(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
) {
  const m =
    /^or1\.([0-9a-f-]{36})\.([1-9][0-9]{0,6})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/.exec(
      token,
    );
  const fail = () => {
    throw new AccountDataError(
      "invalid_unsubscribe",
      "This reminder unsubscribe link is invalid or expired.",
    );
  };
  if (!m || !accountUuid(m[1]) || secret.length < 32) return fail();
  const generation = Number(m[2]),
    expires = Number(m[3]);
  if (generation > 1000000 || expires < now || expires > now + 366 * 86400)
    return fail();
  const supplied = Buffer.from(m[4], "base64url"),
    expected = Buffer.from(
      signReportingUnsubscribe(m[1], generation, expires, secret)
        .split(".")
        .at(-1)!,
      "base64url",
    );
  if (
    supplied.toString("base64url") !== m[4] ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return fail();
  return { id: m[1], generation };
}
const validEmail = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 254 &&
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v);
function state(v: unknown, available: boolean): ReportingReminderState {
  if (
    !accountRecord(v) ||
    typeof v.paused !== "boolean" ||
    !accountRecord(v.preference) ||
    !(v.preference.id === null || accountUuid(v.preference.id)) ||
    typeof v.preference.granted !== "boolean" ||
    !Number.isInteger(v.preference.revision) ||
    v.preference.version !== REPORTING_REMINDER_VERSION ||
    !Number.isInteger(v.preference.generation) ||
    !Array.isArray(v.messages) ||
    v.messages.length > 30 ||
    v.messages.some(
      (m) =>
        !accountRecord(m) ||
        !accountUuid(m.id) ||
        !["closed", "follow_up", "sample"].includes(m.kind as string) ||
        ![
          "queued",
          "sending",
          "accepted",
          "delivered",
          "failed",
          "cancelled",
          "bounced",
          "complained",
        ].includes(m.status as string) ||
        typeof m.createdAt !== "string" ||
        typeof m.updatedAt !== "string",
    )
  )
    throw new ReportingReminderUnavailable();
  return {
    available,
    paused: v.paused,
    preference: v.preference as unknown as ReportingReminderState["preference"],
    messages: v.messages as ReportingReminderState["messages"],
  };
}
function inputConsent(v: unknown) {
  if (
    !accountRecord(v) ||
    Object.keys(v).length !== 3 ||
    typeof v.granted !== "boolean" ||
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 0 ||
    v.consentVersion !== REPORTING_REMINDER_VERSION
  )
    throw new AccountDataError(
      "invalid_reporting_consent",
      "Review the current outcome-reminder permission and save your choice.",
    );
  return { granted: v.granted, revision: v.revision };
}
interface Dependencies {
  rpc: typeof accountRpc;
  configuration: typeof reportingReminderConfiguration;
  readUser: (
    id: string,
  ) => Promise<{ id: string; email: string; confirmed: boolean } | null>;
  fetch: typeof fetch;
}
export function createOutcomeReminderStore(d: Dependencies) {
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const data = await d.rpc(name, args);
    if (accountRecord(data) && typeof data.error === "string") {
      const codes: Record<string, [number, string]> = {
        revision_conflict: [
          409,
          "These reminder settings changed. Reload and try again.",
        ],
        reporting_suppressed: [
          409,
          "Email is paused for this address after a bounce or complaint.",
        ],
        reporting_consent_required: [
          409,
          "Enable outcome-reporting reminders for your current verified email first.",
        ],
        reporting_sample_limit: [
          429,
          "The sample-reminder allowance is one per day and three per month.",
        ],
        reporting_global_limit: [
          429,
          "The reporting-reminder sending allowance is currently full.",
        ],
        reporting_consent_limit: [
          429,
          "This account has reached its reminder opt-in allowance. You can still withdraw.",
        ],
      };
      const e = codes[data.error];
      if (e) throw new AccountDataError(data.error, e[1], e[0]);
      throw new ReportingReminderUnavailable();
    }
    return data;
  };
  const current = async (id: string) => {
    if (!accountUuid(id)) throw new ReportingReminderUnavailable();
    const u = await d.readUser(id);
    if (!u?.confirmed || u.id !== id || !validEmail(u.email))
      throw new AccountDataError(
        "reporting_recipient_unverified",
        "Verify your current account email before requesting reminders.",
        403,
      );
    return { ...u, email: u.email.toLowerCase() };
  };
  const ids = (v: unknown) => {
    if (
      !Array.isArray(v) ||
      v.length > 10 ||
      v.some((id) => !accountUuid(id)) ||
      new Set(v).size !== v.length
    )
      throw new ReportingReminderUnavailable();
    return v as string[];
  };
  const finish = (
    id: string,
    lease: string,
    rev: number,
    status: string,
    provider: string | null,
    error: string | null,
    retry = 0,
  ) =>
    rpc("grader_finish_reporting", {
      p_id: id,
      p_lease: lease,
      p_revision: rev,
      p_status: status,
      p_provider: provider,
      p_error: error,
      p_retry: retry,
    });
  return {
    async read(id: string) {
      if (!accountUuid(id)) throw new ReportingReminderUnavailable();
      return state(
        await rpc("grader_reporting_state", { p_user_id: id }),
        d.configuration().enabled,
      );
    },
    async setConsent(id: string, body: unknown) {
      const input = inputConsent(body),
        c = d.configuration();
      if (input.granted && !c.enabled) throw new ReportingReminderUnavailable();
      const u = await current(id);
      return state(
        await rpc("grader_set_reporting_consent", {
          p_user_id: id,
          p_revision: input.revision,
          p_granted: input.granted,
          p_recipient: u.email,
          p_hash: nurtureRecipientHash(u.email, c.hashSecret),
          p_version: REPORTING_REMINDER_VERSION,
          p_text: REPORTING_REMINDER_CONSENT,
        }),
        c.enabled,
      );
    },
    async unsubscribe(token: string) {
      const v = verifyReportingUnsubscribe(token, d.configuration().hashSecret);
      await rpc("grader_unsubscribe_reporting", {
        p_id: v.id,
        p_generation: v.generation,
      });
    },
    async sample(id: string, body: unknown) {
      if (!d.configuration().enabled) throw new ReportingReminderUnavailable();
      if (
        !accountRecord(body) ||
        Object.keys(body).length !== 2 ||
        !accountUuid(body.requestId) ||
        body.confirm !== "SEND SAMPLE REMINDER"
      )
        throw new AccountDataError(
          "invalid_reporting_sample",
          "Explicitly request a labeled sample for your verified account.",
        );
      const u = await current(id);
      const result = await rpc("grader_reserve_reporting", {
        p_user_id: id,
        p_request_id: body.requestId,
        p_recipient: u.email,
      });
      if (
        !accountRecord(result) ||
        !accountUuid(result.messageId) ||
        typeof result.dispatch !== "boolean"
      )
        throw new ReportingReminderUnavailable();
      return { messageId: result.messageId, dispatch: result.dispatch };
    },
    async reserve() {
      if (!d.configuration().enabled) return [];
      return ids(await rpc("grader_reserve_reporting", {}));
    },
    async release(id: string) {
      await rpc("grader_release_reporting", { p_id: id });
    },
    async exportOwn(id: string) {
      if (!accountUuid(id)) throw new ReportingReminderUnavailable();
      return rpc("grader_export_reporting", { p_user_id: id });
    },
    async purge() {
      await rpc("grader_purge_reporting");
    },
    async operations() {
      const v = await rpc("grader_reporting_operations");
      if (!accountRecord(v)) throw new ReportingReminderUnavailable();
      return {
        ...v,
        enabled: d.configuration().enabled,
        limits: REPORTING_REMINDER_LIMITS,
      };
    },
    async pause(body: unknown) {
      if (
        !accountRecord(body) ||
        Object.keys(body).length !== 2 ||
        !Number.isSafeInteger(body.revision) ||
        Number(body.revision) < 0 ||
        typeof body.paused !== "boolean"
      )
        throw new AccountDataError(
          "invalid_reporting_pause",
          "Choose the current reminder pause setting.",
        );
      await rpc("grader_pause_reporting", {
        p_revision: body.revision,
        p_paused: body.paused,
      });
      return this.operations();
    },
    async process(id: string, lease: string): Promise<{ status: string }> {
      if (!accountUuid(id) || !lease || lease.length > 200)
        throw new ReportingReminderUnavailable();
      const v = await rpc("grader_claim_reporting", {
        p_id: id,
        p_lease: lease,
      });
      if (v === null) return { status: "skipped" };
      if (
        !accountRecord(v) ||
        v.id !== id ||
        !accountUuid(v.preferenceId) ||
        !accountUuid(v.ownerUserId) ||
        !validEmail(v.recipientEmail) ||
        !["closed", "follow_up", "sample"].includes(v.kind as string) ||
        !Number.isInteger(v.revision) ||
        !Number.isInteger(v.attempt) ||
        Number(v.attempt) < 1 ||
        Number(v.attempt) > 4 ||
        !Number.isInteger(v.generation) ||
        typeof v.tokenExpiresAt !== "string" ||
        !Number.isFinite(Date.parse(v.tokenExpiresAt)) ||
        (v.kind !== "sample" &&
          (typeof v.startDate !== "string" ||
            typeof v.endDate !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(v.startDate) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(v.endDate)))
      )
        throw new ReportingReminderUnavailable();
      const rev = Number(v.revision),
        attempt = Number(v.attempt),
        c = d.configuration();
      if (!c.enabled) {
        await finish(id, lease, rev, "queued", null, "paused");
        return { status: "skipped" };
      }
      const u = await d.readUser(v.ownerUserId as string);
      if (
        !u?.confirmed ||
        u.id !== v.ownerUserId ||
        u.email.toLowerCase() !== v.recipientEmail
      ) {
        await finish(id, lease, rev, "cancelled", null, "recipient_changed");
        return { status: "cancelled" };
      }
      const token = signReportingUnsubscribe(
        v.preferenceId as string,
        Number(v.generation),
        Math.floor(Date.parse(v.tokenExpiresAt) / 1000),
        c.hashSecret,
      );
      const fresh = renderReportingReminder({
        kind: v.kind as "sample",
        ...c,
        recipient: v.recipientEmail,
        outboxId: id,
        unsubscribeUrl: `${c.appUrl}/api/outcome-reminders/unsubscribe?token=${token}`,
        ...(v.kind !== "sample"
          ? { startDate: v.startDate as string, endDate: v.endDate as string }
          : {}),
      });
      const message = await rpc("grader_preflight_reporting", {
        p_id: id,
        p_lease: lease,
        p_revision: rev,
        p_recipient: u.email.toLowerCase(),
        p_message: fresh,
      });
      if (accountRecord(message) && message.paused === true) {
        await finish(id, lease, rev, "queued", null, "paused");
        return { status: "skipped" };
      }
      if (message === null) {
        await finish(
          id,
          lease,
          rev,
          "cancelled",
          null,
          "consent_plan_or_suppression",
        );
        return { status: "cancelled" };
      }
      if (
        !accountRecord(message) ||
        message.from !== c.from ||
        !Array.isArray(message.to) ||
        message.to.length !== 1 ||
        message.to[0] !== v.recipientEmail ||
        typeof message.subject !== "string" ||
        message.subject.length > 100 ||
        /[\r\n]/.test(message.subject) ||
        typeof message.html !== "string" ||
        typeof message.text !== "string" ||
        !accountRecord(message.headers) ||
        typeof message.headers["List-Unsubscribe"] !== "string" ||
        !message.headers["List-Unsubscribe"].startsWith(
          `<${c.appUrl}/api/outcome-reminders/unsubscribe?token=`,
        ) ||
        message.headers["List-Unsubscribe-Post"] !==
          "List-Unsubscribe=One-Click" ||
        !Array.isArray(message.tags) ||
        message.tags.length !== 1 ||
        !accountRecord(message.tags[0]) ||
        message.tags[0].name !== "pearl_grader_reporting" ||
        message.tags[0].value !== id ||
        Object.keys(message).some(
          (k) =>
            ![
              "from",
              "to",
              "subject",
              "html",
              "text",
              "headers",
              "tags",
            ].includes(k),
        ) ||
        Buffer.byteLength(JSON.stringify(message)) > 30000
      ) {
        await finish(id, lease, rev, "failed", null, "invalid_frozen_message");
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
            "Idempotency-Key": `pearl-reporting/${id}`,
          },
          body: JSON.stringify(message),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        /* Ambiguous provider outcome retains frozen message and key. */
      }
      if (response?.ok) {
        let provider: unknown;
        try {
          const text = await response.text();
          if (Buffer.byteLength(text) <= 64000) {
            const body: unknown = JSON.parse(text);
            if (accountRecord(body)) provider = body.id;
          }
        } catch {}
        if (accountUuid(provider)) {
          const done = await finish(id, lease, rev, "accepted", provider, null);
          return { status: done === true ? "accepted" : "skipped" };
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
          rev,
          "failed",
          null,
          transient ? "retry_exhausted" : "provider_rejected",
        );
        return { status: "failed" };
      }
      if ((await finish(id, lease, rev, "queued", null, null, retry)) !== true)
        return { status: "skipped" };
      throw new ReportingReminderRetry(retry);
    },
    async abort(id: string, lease: string) {
      await rpc("grader_abort_reporting", { p_id: id, p_lease: lease });
    },
  };
}
const configured = () =>
  createOutcomeReminderStore({
    rpc: accountRpc,
    configuration: reportingReminderConfiguration,
    fetch,
    readUser: async (id) => {
      const { data, error } =
        await accountAdminClient().auth.admin.getUserById(id);
      if (error) throw new ReportingReminderUnavailable();
      const u = data.user;
      return u?.email
        ? { id: u.id, email: u.email, confirmed: !!u.email_confirmed_at }
        : null;
    },
  });
export const readOutcomeReminders = (id: string) => configured().read(id);
export const setOutcomeReminderConsent = (id: string, body: unknown) =>
  configured().setConsent(id, body);
export const unsubscribeOutcomeReminders = (token: string) =>
  configured().unsubscribe(token);
export const reserveOutcomeReminderSample = (id: string, body: unknown) =>
  configured().sample(id, body);
export const reserveDueOutcomeReminders = () => configured().reserve();
export const releaseOutcomeReminderDispatch = (id: string) =>
  configured().release(id);
export const processOutcomeReminder = (id: string, lease: string) =>
  configured().process(id, lease);
export const abortOutcomeReminder = (id: string, lease: string) =>
  configured().abort(id, lease);
export const exportOwnOutcomeReminders = (id: string) =>
  configured().exportOwn(id);
export const purgeOutcomeReminders = () => configured().purge();
export const outcomeReminderOperations = () => configured().operations();
export const pauseOutcomeReminders = (body: unknown) =>
  configured().pause(body);
