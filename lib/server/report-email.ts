import { createHmac } from "node:crypto";
import { accountRpc } from "./account-db";
import { readAccountReport } from "./account-store";
import { accountAdminClient } from "./account-auth";
import {
  accountRecord,
  accountUuid,
  AccountDataError,
} from "../account/validation";
import type { CloudReport } from "../account/types";
import type { ReportEmailRequest } from "../account/email-types";

if (typeof window !== "undefined")
  throw new Error("Report email must run on the server.");
export const REPORT_EMAIL_TEMPLATE = "report-summary-v1";
const DEFAULT_APP_URL = "https://pearl-legal-grader.vercel.app";
const validEmail = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 254 &&
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
export class ReportEmailUnavailable extends Error {
  readonly code = "report_email_unavailable";
  readonly status = 503;
  constructor() {
    super(
      "Report email is temporarily unavailable. Your saved report remains in your private dashboard.",
    );
    this.name = "ReportEmailUnavailable";
  }
}
export class ReportEmailRetry extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      "The email provider is temporarily unavailable. The same request will be retried safely.",
    );
    this.name = "ReportEmailRetry";
  }
}
interface EmailConfiguration {
  key: string;
  from: string;
  appUrl: string;
  enabled: boolean;
  hashSecret: string;
}
export function reportEmailConfiguration(
  env: Record<string, string | undefined> = process.env,
): EmailConfiguration {
  const key = env.RESEND_API_KEY?.trim() || "";
  const from = env.GRADER_EMAIL_FROM?.trim() || "";
  const hashSecret = env.SCAN_HASH_SECRET || "";
  const address = from
    .match(/^(?:[A-Za-z0-9 ._-]{1,80} <([^<>]+)>|([^<>]+))$/)
    ?.slice(1)
    .find(Boolean);
  let appUrl = DEFAULT_APP_URL;
  let validUrl = true;
  if (env.GRADER_APP_URL) {
    try {
      const u = new URL(env.GRADER_APP_URL);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        u.pathname !== "/"
      )
        throw new Error();
      appUrl = u.origin;
    } catch {
      validUrl = false;
    }
  }
  return {
    key,
    from,
    appUrl,
    hashSecret,
    enabled:
      env.REPORT_EMAIL_ENABLED === "true" &&
      /^re_[A-Za-z0-9_-]{10,500}$/.test(key) &&
      !!address &&
      validEmail(address) &&
      validUrl &&
      hashSecret.length >= 32,
  };
}
export function reportEmailEnabled(): boolean {
  return reportEmailConfiguration().enabled;
}
export function parseReportEmailRequest(value: unknown): { requestId: string } {
  if (
    !accountRecord(value) ||
    Object.keys(value).some((key) => key !== "requestId") ||
    !accountUuid(value.requestId)
  )
    throw new AccountDataError(
      "invalid_email_request",
      "Request this saved report using a new request identifier.",
    );
  return { requestId: value.requestId };
}
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
interface ResendMessage {
  from: string;
  to: [string];
  subject: string;
  html: string;
  text: string;
}
const DELIVERY_EVENTS = [
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.delivery_delayed",
  "email.suppressed",
];
/** Do not include private answers, financial/control findings, scores, credentials or raw practice labels. */
export function renderReportEmail(
  report: CloudReport,
  recipient: string,
  configuration: Pick<EmailConfiguration, "from" | "appUrl">,
): ResendMessage {
  if (!validEmail(recipient)) throw new ReportEmailUnavailable();
  const date = new Date(report.snapshot.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const scope = report.snapshot.websiteScan
    ? "Owner-reported practice assessment and a separate public website check"
    : "Owner-reported practice assessment";
  const safeActions = report.snapshot.assessment.actions
    .filter(
      (action) => action.domain !== "cash" && action.trigger.type !== "control",
    )
    .slice(0, 3)
    .map((action) =>
      action.title.replace(/[\r\n\u0000-\u001f]/g, " ").slice(0, 160),
    );
  for (const title of [
    "Review your private recommendations in the dashboard",
    "Choose one next action and a target date",
    "Return to record progress and reassess",
  ])
    if (safeActions.length < 3 && !safeActions.includes(title))
      safeActions.push(title);
  const link = new URL("/account", configuration.appUrl).href;
  const text = `Your Pearl practice report\n\nAssessment date: ${date}\nScope: ${scope}\n\nThree next steps\n${safeActions.map((action, i) => `${i + 1}. ${action}`).join("\n")}\n\nOpen your private dashboard: ${link}\nSign in to read the full report. Private answers and financial or control details stay in the dashboard.\n\nThis is a provisional business assessment, not a legal skill, licensing or compliance certification. Completing an action does not establish an improvement.\n\nYou requested this summary. This does not subscribe you to reminders or marketing.`;
  const html = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your Pearl practice report</title></head><body style="margin:0;background:#f5f7f6;color:#172d2a;font-family:Arial,sans-serif"><div lang="en" dir="ltr" style="max-width:600px;margin:0 auto;padding:32px 24px;background:#ffffff;font-size:16px;line-height:1.6"><p style="color:#42645b;font-size:14px">PEARL · PRACTICE GRADER</p><h1 style="font-size:28px;line-height:1.2">Your saved practice report</h1><p><strong>Assessment date:</strong> ${escapeHtml(date)}<br><strong>Scope:</strong> ${escapeHtml(scope)}</p><p>Your full report is saved in your private dashboard.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:13px 22px;background:#164d40;color:#ffffff;text-decoration:none;border-radius:6px;min-height:20px">Open your private dashboard</a></p><h2 style="font-size:21px">Three next steps</h2><ol>${safeActions.map((title) => `<li style="margin-bottom:8px">${escapeHtml(title)}</li>`).join("")}</ol><p>Sign in to read the full report. Private answers and financial or control details stay in the dashboard.</p><p style="font-size:14px;color:#4c625c">This is a provisional business assessment, not a legal skill, licensing or compliance certification. Completing an action does not establish an improvement.</p><p style="font-size:13px;color:#4c625c">You requested this summary. This does not subscribe you to reminders or marketing.</p></div></body></html>`;
  return {
    from: configuration.from,
    to: [recipient.toLowerCase()],
    subject: "Your saved Pearl practice report",
    html,
    text,
  };
}
function decodeRequest(value: unknown): ReportEmailRequest {
  if (
    !accountRecord(value) ||
    !accountUuid(value.id) ||
    ![
      "queued",
      "sending",
      "accepted",
      "delivered",
      "bounced",
      "complained",
      "failed",
      "unavailable",
    ].includes(value.status as string) ||
    typeof value.requestedAt !== "string" ||
    !Number.isFinite(Date.parse(value.requestedAt)) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    (value.errorCode !== undefined &&
      (typeof value.errorCode !== "string" ||
        !/^[a-z_]{1,80}$/.test(value.errorCode))) ||
    (value.deliveryEvent !== undefined &&
      !DELIVERY_EVENTS.includes(value.deliveryEvent as string))
  )
    throw new ReportEmailUnavailable();
  return {
    id: value.id,
    status: value.status as ReportEmailRequest["status"],
    requestedAt: value.requestedAt,
    updatedAt: value.updatedAt,
    ...(value.errorCode ? { errorCode: value.errorCode as string } : {}),
    ...(typeof value.deliveryEvent === "string"
      ? { deliveryEvent: value.deliveryEvent }
      : {}),
  };
}
function emailRpcError(value: unknown) {
  if (!accountRecord(value) || typeof value.error !== "string") return;
  const errors: Record<string, [number, string]> = {
    not_found: [404, "This saved report is unavailable in your account."],
    recipient_unverified: [
      403,
      "Verify your current account email before requesting a report.",
    ],
    email_request_conflict: [
      409,
      "This request identifier already belongs to another report.",
    ],
    email_suppressed: [
      409,
      "Report email is paused for this address after a bounce or complaint. Your private dashboard remains available.",
    ],
    email_account_limit: [
      429,
      "You have reached this preview’s report-email allowance. Your dashboard remains available.",
    ],
    email_global_limit: [
      429,
      "The preview has reached its report-email allowance. Your dashboard remains available.",
    ],
  };
  const error = errors[value.error];
  if (error) throw new AccountDataError(value.error, error[1], error[0]);
  throw new ReportEmailUnavailable();
}
interface EmailDependencies {
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  readReport: typeof readAccountReport;
  configuration: () => EmailConfiguration;
  fetch: typeof fetch;
  readUser: (
    id: string,
  ) => Promise<{ id: string; email: string; confirmed: boolean } | null>;
}
export function createReportEmailService(dependencies: EmailDependencies) {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const data = await dependencies.rpc(name, args);
    emailRpcError(data);
    return data;
  };
  const finish = async (
    id: string,
    lease: string,
    revision: number,
    status: string,
    providerId: string | null,
    errorCode: string | null,
    retry = 0,
  ) =>
    rpc("grader_finish_report_email", {
      p_outbox_id: id,
      p_lease_id: lease,
      p_revision: revision,
      p_status: status,
      p_provider_id: providerId,
      p_error_code: errorCode,
      p_retry_seconds: retry,
    });
  return {
    async reserve(
      user: { id: string; email: string },
      reportId: string,
      body: unknown,
    ) {
      const configuration = dependencies.configuration();
      if (!configuration.enabled) throw new ReportEmailUnavailable();
      if (
        !accountUuid(user.id) ||
        !accountUuid(reportId) ||
        !validEmail(user.email)
      )
        throw new AccountDataError(
          "invalid_email_request",
          "Choose a saved report and verified account.",
        );
      const { requestId } = parseReportEmailRequest(body);
      const report = await dependencies.readReport(user.id, reportId);
      const message = renderReportEmail(report, user.email, configuration);
      const data = await rpc("grader_reserve_report_email", {
        p_user_id: user.id,
        p_report_id: reportId,
        p_request_id: requestId,
        p_recipient: user.email.toLowerCase(),
        p_template_version: REPORT_EMAIL_TEMPLATE,
        p_message: message,
        p_recipient_hash: createHmac("sha256", configuration.hashSecret)
          .update(`report-email-recipient:${user.email.toLowerCase()}`)
          .digest("hex"),
        p_account_hash: createHmac("sha256", configuration.hashSecret)
          .update(`report-email-account:${user.id}`)
          .digest("hex"),
      });
      if (
        !accountRecord(data) ||
        typeof data.start !== "boolean" ||
        typeof data.created !== "boolean"
      )
        throw new ReportEmailUnavailable();
      return {
        email: decodeRequest(data.email),
        start: data.start,
        created: data.created,
      };
    },
    async list(
      userId: string,
      reportId: string,
    ): Promise<ReportEmailRequest[]> {
      if (!accountUuid(userId) || !accountUuid(reportId))
        throw new AccountDataError(
          "not_found",
          "This saved report is unavailable.",
          404,
        );
      const data = await rpc("grader_list_report_emails", {
        p_user_id: userId,
        p_report_id: reportId,
      });
      if (!Array.isArray(data) || data.length > 10)
        throw new ReportEmailUnavailable();
      return data.map(decodeRequest);
    },
    async recordWorkflow(id: string, runId: string) {
      await rpc("grader_record_report_email_workflow", {
        p_outbox_id: id,
        p_run_id: runId,
      });
    },
    async export(
      userId: string,
    ): Promise<Array<ReportEmailRequest & { reportId: string }>> {
      if (!accountUuid(userId)) throw new ReportEmailUnavailable();
      const data = await rpc("grader_export_report_emails", {
        p_user_id: userId,
      });
      if (!Array.isArray(data) || data.length > 1000)
        throw new ReportEmailUnavailable();
      return data.map((value) => {
        if (!accountRecord(value) || !accountUuid(value.reportId))
          throw new ReportEmailUnavailable();
        return { ...decodeRequest(value), reportId: value.reportId };
      });
    },
    async failQueue(id: string) {
      await rpc("grader_fail_report_email_queue", { p_outbox_id: id });
    },
    async process(
      id: string,
      leaseId: string,
    ): Promise<{ status: "accepted" | "failed" | "unavailable" | "skipped" }> {
      if (!accountUuid(id) || !leaseId || leaseId.length > 200)
        throw new ReportEmailUnavailable();
      const data = await rpc("grader_claim_report_email", {
        p_outbox_id: id,
        p_lease_id: leaseId,
      });
      if (data === null) return { status: "skipped" };
      if (
        !accountRecord(data) ||
        data.id !== id ||
        !accountUuid(data.ownerUserId) ||
        !validEmail(data.recipientEmail) ||
        !Number.isInteger(data.revision) ||
        !Number.isInteger(data.attempt) ||
        Number(data.attempt) < 1 ||
        Number(data.attempt) > 4 ||
        !accountRecord(data.message)
      )
        throw new ReportEmailUnavailable();
      const revision = data.revision as number,
        attempt = data.attempt as number;
      const configuration = dependencies.configuration();
      if (!configuration.enabled) {
        await finish(
          id,
          leaseId,
          revision,
          "unavailable",
          null,
          "configuration_unavailable",
        );
        return { status: "unavailable" };
      }
      const recipient = await dependencies.readUser(data.ownerUserId as string);
      if (
        !recipient?.confirmed ||
        recipient.id !== data.ownerUserId ||
        recipient.email.toLowerCase() !== data.recipientEmail
      ) {
        await finish(
          id,
          leaseId,
          revision,
          "unavailable",
          null,
          "recipient_changed",
        );
        return { status: "unavailable" };
      }
      const message = data.message;
      if (
        typeof message.from !== "string" ||
        !Array.isArray(message.to) ||
        message.to.length !== 1 ||
        !validEmail(message.to[0]) ||
        message.to[0] !== data.recipientEmail ||
        typeof message.subject !== "string" ||
        message.subject.length > 300 ||
        /[\r\n]/.test(message.subject) ||
        typeof message.html !== "string" ||
        typeof message.text !== "string" ||
        Object.keys(message).some(
          (key) =>
            !["from", "to", "subject", "html", "text", "tags"].includes(key),
        ) ||
        (message.tags !== undefined &&
          (!Array.isArray(message.tags) ||
            message.tags.length !== 1 ||
            !accountRecord(message.tags[0]) ||
            message.tags[0].name !== "pearl_grader_report" ||
            message.tags[0].value !== id)) ||
        Buffer.byteLength(JSON.stringify(message)) > 50000
      ) {
        await finish(
          id,
          leaseId,
          revision,
          "failed",
          null,
          "provider_rejected",
        );
        return { status: "failed" };
      }
      let response: Response | undefined;
      let transient = true;
      let retry = Math.min(120, 5 * 2 ** (attempt - 1));
      try {
        response = await dependencies.fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${configuration.key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `pearl-report/${id}`,
          },
          body: JSON.stringify(message),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        /* Ambiguous provider outcome: retry exactly the frozen body and idempotency key. */
      }
      if (response?.ok) {
        let providerId: unknown;
        try {
          const raw = await response.text();
          if (Buffer.byteLength(raw) <= 64000) {
            const parsed: unknown = JSON.parse(raw);
            if (accountRecord(parsed)) providerId = parsed.id;
          }
        } catch {}
        if (accountUuid(providerId)) {
          const saved = await finish(
            id,
            leaseId,
            revision,
            "accepted",
            providerId,
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
      if (!transient) {
        await finish(
          id,
          leaseId,
          revision,
          "failed",
          null,
          "provider_rejected",
        );
        return { status: "failed" };
      }
      const saved = await finish(
        id,
        leaseId,
        revision,
        attempt >= 4 ? "failed" : "queued",
        null,
        attempt >= 4 ? "retry_exhausted" : null,
        retry,
      );
      if (saved !== true) return { status: "skipped" };
      if (attempt >= 4) return { status: "failed" };
      throw new ReportEmailRetry(retry);
    },
    async abort(id: string, leaseId: string) {
      await rpc("grader_abort_report_email", {
        p_outbox_id: id,
        p_lease_id: leaseId,
      });
    },
    async purge() {
      await rpc("grader_purge_report_emails", {});
    },
  };
}
const configured = () =>
  createReportEmailService({
    rpc: accountRpc,
    readReport: readAccountReport,
    configuration: reportEmailConfiguration,
    fetch,
    readUser: async (id) => {
      const { data, error } =
        await accountAdminClient().auth.admin.getUserById(id);
      if (error) throw new ReportEmailUnavailable();
      const user = data.user;
      return user?.email
        ? {
            id: user.id,
            email: user.email,
            confirmed: !!user.email_confirmed_at,
          }
        : null;
    },
  });
export const reserveReportEmail = (
  user: { id: string; email: string },
  reportId: string,
  body: unknown,
) => configured().reserve(user, reportId, body);
export const listReportEmails = (userId: string, reportId: string) =>
  configured().list(userId, reportId);
export const exportReportEmails = (userId: string) =>
  configured().export(userId);
export const recordReportEmailWorkflow = (id: string, runId: string) =>
  configured().recordWorkflow(id, runId);
export const failReportEmailQueue = (id: string) => configured().failQueue(id);
export const processReportEmail = (id: string, leaseId: string) =>
  configured().process(id, leaseId);
export const abortReportEmail = (id: string, leaseId: string) =>
  configured().abort(id, leaseId);
export const purgeReportEmails = () => configured().purge();
