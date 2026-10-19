import {
  accountRecord,
  accountUuid,
  validRevision,
  parseAccountReport,
} from "../account/validation";
import {
  HELP_STATUSES,
  HELP_TOPICS,
  type HelpStatus,
  type HelpTopic,
} from "../help-requests";
import {
  LEAD_ROUTING_CONSENT_TEXT,
  LEAD_ROUTING_CONSENT_VERSION,
  LEAD_ROUTING_POLICY_VERSION,
  safeRoutingSummary,
  validRoutingEmail,
  type LeadReportSummary,
  type RequestedContactDetail,
} from "../lead-routing";
import { accountRpc } from "./account-db";
import { accountAdminClient } from "./account-auth";
import { readAccountReport } from "./account-store";
import { getApprovedConfigRelease } from "./config-store";
if (typeof window !== "undefined")
  throw new Error("Requested-contact details must run on the server.");
export class LeadRoutingError extends Error {
  constructor(
    public readonly status = 503,
    public readonly code = "contact_queue_unavailable",
    message = "The requested-contact queue is temporarily unavailable.",
  ) {
    super(message);
    this.name = "LeadRoutingError";
  }
}
export interface RequestedContactQueueItem {
  id: string;
  topic: HelpTopic;
  status: HelpStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  contactConsent: boolean;
  canViewContact: boolean;
  hasSelectedReport: boolean;
}
const stamp = (v: unknown): v is string =>
  typeof v === "string" && v.length < 60 && Number.isFinite(Date.parse(v));
function item(value: unknown): RequestedContactQueueItem {
  if (
    !accountRecord(value) ||
    !accountUuid(value.id) ||
    !HELP_TOPICS.includes(value.topic as HelpTopic) ||
    !HELP_STATUSES.includes(value.status as HelpStatus) ||
    !validRevision(value.revision) ||
    !stamp(value.createdAt) ||
    !stamp(value.updatedAt) ||
    typeof value.contactConsent !== "boolean" ||
    typeof value.canViewContact !== "boolean" ||
    typeof value.hasSelectedReport !== "boolean"
  )
    throw new LeadRoutingError();
  return {
    id: value.id,
    topic: value.topic as HelpTopic,
    status: value.status as HelpStatus,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    contactConsent: value.contactConsent,
    canViewContact: value.canViewContact,
    hasSelectedReport: value.hasSelectedReport,
  };
}
interface ContactDependencies {
  rpc: typeof accountRpc;
  verifiedEmail: (id: string) => Promise<string | null>;
  reportSummary: (
    userId: string,
    reportId: string,
  ) => Promise<LeadReportSummary | null>;
}
export function createLeadRoutingStore(deps: ContactDependencies) {
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const data = await deps.rpc(name, args);
    if (accountRecord(data) && typeof data.error === "string") {
      if (data.error === "contact_view_limit")
        throw new LeadRoutingError(
          429,
          data.error,
          "This account has reached its contact-view allowance. Try again later.",
        );
      throw new LeadRoutingError(
        data.error === "not_found" ? 404 : 409,
        "contact_permission_unavailable",
        "Contact permission is unavailable or changed. Refresh the queue.",
      );
    }
    return data;
  };
  return {
    async queue() {
      const data = await rpc("grader_requested_contact_queue");
      if (
        !accountRecord(data) ||
        !Array.isArray(data.requests) ||
        data.requests.length > 100 ||
        typeof data.truncated !== "boolean"
      )
        throw new LeadRoutingError();
      return {
        policyVersion: LEAD_ROUTING_POLICY_VERSION,
        scope:
          "New explicit requests in Pearl's private follow-up queue. No automatic messages or external CRM integration.",
        requests: data.requests.map(item),
        truncated: data.truncated,
      };
    },
    async viewContact(
      actorId: string,
      requestId: string,
      body: unknown,
    ): Promise<RequestedContactDetail> {
      if (
        !accountUuid(actorId) ||
        !accountUuid(requestId) ||
        !accountRecord(body) ||
        Object.keys(body).length !== 2 ||
        body.confirm !== "VIEW REQUESTED CONTACT" ||
        !validRevision(body.revision)
      )
        throw new LeadRoutingError(
          400,
          "invalid_contact_view",
          "Choose a current request and explicitly view its purpose-bound contact details.",
        );
      const source = await rpc("grader_prepare_requested_contact", {
        p_actor: actorId,
        p_request_id: requestId,
        p_revision: body.revision,
      });
      if (
        !accountRecord(source) ||
        !accountUuid(source.ownerUserId) ||
        source.requestId !== requestId ||
        !validRevision(source.revision) ||
        source.revision !== body.revision ||
        !HELP_TOPICS.includes(source.topic as HelpTopic) ||
        source.consentVersion !== LEAD_ROUTING_CONSENT_VERSION ||
        source.consentText !== LEAD_ROUTING_CONSENT_TEXT ||
        !(source.reportId === null || accountUuid(source.reportId))
      )
        throw new LeadRoutingError();
      const recipient = await deps.verifiedEmail(source.ownerUserId);
      if (!validRoutingEmail(recipient))
        throw new LeadRoutingError(
          409,
          "contact_email_unverified",
          "The current account email is not verified. No contact detail is available.",
        );
      const summary =
        source.reportId === null
          ? null
          : await deps.reportSummary(source.ownerUserId, source.reportId);
      if (summary !== null && !safeRoutingSummary(summary))
        throw new LeadRoutingError();
      const current = await deps.verifiedEmail(source.ownerUserId);
      if (current?.toLowerCase() !== recipient.toLowerCase())
        throw new LeadRoutingError(
          409,
          "contact_email_changed",
          "The account email changed. Refresh before viewing contact details.",
        );
      const permitted = await rpc("grader_record_requested_contact_view", {
        p_actor: actorId,
        p_request_id: requestId,
        p_revision: source.revision,
        p_report_id: source.reportId,
      });
      if (permitted !== true)
        throw new LeadRoutingError(
          409,
          "contact_permission_changed",
          "Contact permission changed. No contact details are available.",
        );
      return {
        requestId,
        verifiedEmail: recipient.toLowerCase(),
        topic: source.topic as HelpTopic,
        consentVersion: LEAD_ROUTING_CONSENT_VERSION,
        consentText: LEAD_ROUTING_CONSENT_TEXT,
        reportSummary: summary === null ? null : safeRoutingSummary(summary),
        emailVerificationNote:
          "A verified account email does not verify a law license or authority to represent a practice. Use it only for this selected request.",
      };
    },
    async exportOwn(userId: string) {
      if (!accountUuid(userId)) throw new LeadRoutingError();
      const data = await rpc("grader_requested_contact_export", {
        p_user_id: userId,
      });
      if (
        !accountRecord(data) ||
        !Array.isArray(data.contactViews) ||
        data.contactViews.length > 1000 ||
        typeof data.historyTruncated !== "boolean"
      )
        throw new LeadRoutingError();
      return {
        policyVersion: LEAD_ROUTING_POLICY_VERSION,
        historyTruncated: data.historyTruncated,
        contactViews: data.contactViews.map((event) => {
          if (
            !accountRecord(event) ||
            !accountUuid(event.requestId) ||
            !stamp(event.viewedAt)
          )
            throw new LeadRoutingError();
          return {
            requestId: event.requestId,
            viewedAt: event.viewedAt,
            purpose: "Requested Pearl follow-up",
          };
        }),
      };
    },
    async purgeContactViews() {
      if ((await rpc("grader_purge_requested_contact_views")) !== true)
        throw new LeadRoutingError();
    },
  };
}
export const leadRoutingStore = () =>
  createLeadRoutingStore({
    rpc: accountRpc,
    verifiedEmail: async (id) => {
      const { data, error } =
        await accountAdminClient().auth.admin.getUserById(id);
      if (error) {
        if (error.status === 404) return null;
        throw new LeadRoutingError();
      }
      return data.user?.id === id &&
        data.user.email_confirmed_at &&
        data.user.email
        ? data.user.email
        : null;
    },
    reportSummary: async (userId, reportId) => {
      try {
        const stored = await readAccountReport(userId, reportId);
        const approved = await getApprovedConfigRelease(
          stored.snapshot.assessment.releaseId,
        );
        if (!approved) return null;
        const { report } = parseAccountReport(
          { report: stored.snapshot },
          approved,
        );
        return safeRoutingSummary({
          score: report.assessment.overallScore,
          coveragePercent: report.assessment.coverage * 100,
          rubricVersion: report.assessment.releaseId,
        });
      } catch {
        return null;
      }
    },
  });
export const purgeContactViews = () => leadRoutingStore().purgeContactViews();
export function leadRoutingErrorResponse(error: LeadRoutingError) {
  return Response.json(
    { error: error.message, code: error.code },
    {
      status: error.status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
