import { createHmac } from "node:crypto";
import { accountRecord, accountUuid } from "../account/validation";
import {
  csvCell,
  researchCsv,
  researchDataset,
  researchSummary,
  RESEARCH_LIMITATIONS,
  RESEARCH_POLICY_VERSION,
  type ResearchCandidate,
} from "../research";
import {
  HELP_CONSENT_TEXT,
  HELP_CONSENT_VERSION,
  HELP_STATUSES,
  HELP_TOPICS,
  parseHelpInput,
  type HelpRequest,
  type HelpStatus,
  type HelpTopic,
} from "../help-requests";
import { accountRpc } from "./account-db";
import { getActiveConfig } from "./config-store";
import { accountAdminClient } from "./account-auth";

if (typeof window !== "undefined")
  throw new Error("Research and requested-help storage is server-only.");
export class ResearchServiceError extends Error {
  constructor(
    public readonly status = 503,
    public readonly code = "research_unavailable",
    message = "This service is temporarily unavailable. Please try again.",
  ) {
    super(message);
    this.name = "ResearchServiceError";
  }
}
const stamp = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length < 60 &&
  Number.isFinite(Date.parse(value));
function checkRpc(value: unknown): unknown {
  if (!accountRecord(value) || typeof value.error !== "string") return value;
  const errors: Record<string, [number, string]> = {
    not_found: [404, "This request or report is unavailable in your account."],
    request_conflict: [
      409,
      "This request already exists with different details.",
    ],
    request_limit: [
      429,
      "You have reached the daily help-request allowance. Please try again later.",
    ],
    revision_conflict: [
      409,
      "This request changed. Refresh before updating it.",
    ],
    consent_withdrawn: [
      409,
      "Contact permission was withdrawn. This request cannot be reopened.",
    ],
  };
  const error = errors[value.error];
  throw new ResearchServiceError(error?.[0] ?? 503, value.error, error?.[1]);
}
function helpRequest(value: unknown): HelpRequest {
  checkRpc(value);
  if (
    !accountRecord(value) ||
    !accountUuid(value.id) ||
    !HELP_TOPICS.includes(value.topic as HelpTopic) ||
    !HELP_STATUSES.includes(value.status as HelpStatus) ||
    !stamp(value.createdAt) ||
    !stamp(value.updatedAt) ||
    value.consentVersion !== HELP_CONSENT_VERSION ||
    typeof value.consentText !== "string" ||
    value.consentText.length > 1000 ||
    typeof value.contactConsent !== "boolean" ||
    !(value.reportId === null || accountUuid(value.reportId)) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    throw new ResearchServiceError();
  return {
    id: value.id,
    topic: value.topic as HelpTopic,
    status: value.status as HelpStatus,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    consentVersion: value.consentVersion,
    consentText: value.consentText,
    contactConsent: value.contactConsent,
    reportId: value.reportId,
    revision: value.revision,
  };
}
export interface AdminHelpRequest extends HelpRequest {
  verifiedEmail: string | null;
}
interface ResearchDependencies {
  rpc: typeof accountRpc;
  activeConfig: typeof getActiveConfig;
  pseudonym: (id: string) => string;
  verifiedEmail?: (id: string) => Promise<string | null>;
  now?: () => Date;
}
export function createResearchStore(dependencies: ResearchDependencies) {
  const rpc = async (name: string, args: Record<string, unknown> = {}) =>
    checkRpc(await dependencies.rpc(name, args));
  const identity = (id: string) => {
    if (!accountUuid(id)) throw new ResearchServiceError();
  };
  return {
    async dataset() {
      const active = await dependencies.activeConfig();
      const candidates: ResearchCandidate[] = [];
      let after: string | null = null;
      let truncated = false;
      for (let page = 0; page < 50; page++) {
        const rows = await rpc("grader_research_source_page", {
          p_release_id: active.release.id,
          p_after: after,
          p_limit: 10,
        });
        if (!Array.isArray(rows) || rows.length > 10)
          throw new ResearchServiceError();
        for (const row of rows) {
          if (
            !accountRecord(row) ||
            !accountUuid(row.workspaceId) ||
            row.benchmarking !== true ||
            !accountRecord(row.report) ||
            !Array.isArray(row.progress) ||
            row.progress.length > 100 ||
            row.progress.some(
              (item) =>
                !accountRecord(item) ||
                typeof item.actionId !== "string" ||
                item.actionId.length > 100,
            )
          )
            throw new ResearchServiceError();
          candidates.push(row as unknown as ResearchCandidate);
        }
        if (rows.length < 10) break;
        const cursor = (rows[rows.length - 1] as ResearchCandidate).workspaceId;
        if (after && cursor <= after) throw new ResearchServiceError();
        after = cursor;
        if (page === 49) truncated = true;
      }
      const dataset = researchDataset(
        candidates,
        active.release,
        dependencies.pseudonym,
        dependencies.now?.() ?? new Date(),
      );
      if (candidates.length) {
        const permitted = await rpc("grader_research_current_consent", {
          p_workspace_ids: [
            ...new Set(candidates.map((candidate) => candidate.workspaceId)),
          ],
        });
        if (
          !Array.isArray(permitted) ||
          permitted.some((id) => !accountUuid(id))
        )
          throw new ResearchServiceError();
        const allowed = new Set(
          (permitted as string[]).map(dependencies.pseudonym),
        );
        dataset.rows = dataset.rows.filter((row) =>
          allowed.has(row.workspacePseudonym),
        );
      }
      return {
        ...dataset,
        activeReleaseId: active.release.id,
        contentHash: active.contentHash,
        truncated,
        summary: researchSummary(dataset.rows, truncated),
      };
    },
    async counts() {
      const data = await rpc("grader_research_counts");
      if (
        !accountRecord(data) ||
        ![
          data.workspaces,
          data.benchmarkingConsent,
          data.marketingConsent,
        ].every(
          (value) =>
            typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 0,
        ) ||
        !accountRecord(data.helpRequestsByStatus) ||
        Object.entries(data.helpRequestsByStatus).some(
          ([key, value]) =>
            !HELP_STATUSES.includes(key as HelpStatus) ||
            typeof value !== "number" ||
            !Number.isSafeInteger(value) ||
            value < 0,
        )
      )
        throw new ResearchServiceError();
      return {
        workspaces: data.workspaces as number,
        benchmarkingConsent: data.benchmarkingConsent as number,
        marketingConsent: data.marketingConsent as number,
        helpRequestsByStatus: data.helpRequestsByStatus as Partial<
          Record<HelpStatus, number>
        >,
      };
    },
    async requestHelp(userId: string, body: unknown) {
      identity(userId);
      const input = parseHelpInput(body);
      if (!input)
        throw new ResearchServiceError(
          400,
          "invalid_help_request",
          "Choose a business need and explicitly agree to requested follow-up.",
        );
      const data = await rpc("grader_lead_request_help", {
        p_user_id: userId,
        p_request_id: input.requestId,
        p_topic: input.topic,
        p_report_id: input.reportId,
        p_consent_version: HELP_CONSENT_VERSION,
        p_consent_text: HELP_CONSENT_TEXT,
      });
      if (!accountRecord(data) || typeof data.created !== "boolean")
        throw new ResearchServiceError();
      return { created: data.created, request: helpRequest(data.request) };
    },
    async ownRequests(userId: string) {
      identity(userId);
      const data = await rpc("grader_lead_list_own", { p_user_id: userId });
      if (!Array.isArray(data) || data.length > 2000)
        throw new ResearchServiceError();
      return data.map(helpRequest);
    },
    async withdrawRequest(userId: string, id: string) {
      identity(userId);
      if (!accountUuid(id))
        throw new ResearchServiceError(
          404,
          "not_found",
          "This help request is unavailable.",
        );
      return helpRequest(
        await rpc("grader_lead_withdraw", { p_user_id: userId, p_id: id }),
      );
    },
    async adminRequests(): Promise<AdminHelpRequest[]> {
      const data = await rpc("grader_lead_admin_list");
      if (!Array.isArray(data) || data.length > 500)
        throw new ResearchServiceError();
      return data.map((item) => {
        const request = helpRequest(item);
        if (
          !accountRecord(item) ||
          !(
            item.verifiedEmail === null ||
            (typeof item.verifiedEmail === "string" &&
              item.verifiedEmail.length <= 254 &&
              /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.verifiedEmail))
          )
        )
          throw new ResearchServiceError();
        return {
          ...request,
          verifiedEmail: null,
        };
      });
    },
    async updateRequest(actorId: string, id: string, body: unknown) {
      identity(actorId);
      if (
        !accountUuid(id) ||
        !accountRecord(body) ||
        Object.keys(body).some(
          (key) => !["status", "revision", "reason"].includes(key),
        ) ||
        !HELP_STATUSES.includes(body.status as HelpStatus) ||
        typeof body.revision !== "number" ||
        !Number.isSafeInteger(body.revision) ||
        body.revision < 0 ||
        typeof body.reason !== "string" ||
        body.reason.trim().length < 10 ||
        body.reason.trim().length > 500
      )
        throw new ResearchServiceError(
          400,
          "invalid_lead_change",
          "Choose a status, current revision and reason of 10–500 characters.",
        );
      return helpRequest(
        await rpc("grader_lead_update_status", {
          p_id: id,
          p_status: body.status,
          p_revision: body.revision,
          p_actor: actorId,
          p_reason: body.reason.trim(),
        }),
      );
    },
    async leadCsv(purpose: string) {
      if (!["requested_help", "marketing"].includes(purpose))
        throw new ResearchServiceError(
          400,
          "invalid_export_purpose",
          "Choose requested help or marketing as a separate export purpose.",
        );
      const data = await rpc("grader_lead_export", { p_purpose: purpose });
      if (!Array.isArray(data)) throw new ResearchServiceError();
      if (data.length > 500)
        throw new ResearchServiceError(
          409,
          "export_limit",
          "This handoff exceeds the preview's 500-row allowance. A reviewed segmented export is needed.",
        );
      const headers = [
        "verified_email",
        "permission_purpose",
        "selected_business_need",
        "request_status",
        "consent_version",
        "consent_recorded_date",
      ];
      const contacts: { key: string; values: unknown[] }[] = [];
      const emails = new Map<string, Promise<string | null>>();
      const exportKey = (row: Record<string, unknown>) =>
        [
          row.ownerUserId,
          row.purpose,
          row.topic,
          row.status,
          row.consentVersion,
          row.consentRecordedAt,
        ].join("|");
      for (let start = 0; start < data.length; start += 8) {
        await Promise.all(
          data.slice(start, start + 8).map(async (row) => {
            if (
              !accountRecord(row) ||
              !accountUuid(row.ownerUserId) ||
              row.purpose !== purpose ||
              !(
                row.topic === null ||
                HELP_TOPICS.includes(row.topic as HelpTopic)
              ) ||
              typeof row.status !== "string" ||
              row.status.length > 50 ||
              typeof row.consentVersion !== "string" ||
              row.consentVersion.length > 100 ||
              !stamp(row.consentRecordedAt)
            )
              throw new ResearchServiceError();
            if (!dependencies.verifiedEmail) throw new ResearchServiceError();
            if (!emails.has(row.ownerUserId))
              emails.set(
                row.ownerUserId,
                dependencies.verifiedEmail(row.ownerUserId),
              );
            const email = await emails.get(row.ownerUserId)!;
            if (!email) return;
            if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
              throw new ResearchServiceError();
            contacts.push({
              key: exportKey(row),
              values: [
                email,
                row.purpose,
                row.topic,
                row.status,
                row.consentVersion,
                row.consentRecordedAt.slice(0, 10),
              ],
            });
          }),
        );
      }
      const current = await rpc("grader_lead_export", { p_purpose: purpose });
      if (!Array.isArray(current) || current.some((row) => !accountRecord(row)))
        throw new ResearchServiceError();
      const allowed = new Set(
        current.map((row) => exportKey(row as Record<string, unknown>)),
      );
      return (
        [
          headers.map(csvCell).join(","),
          ...contacts
            .filter((contact) => allowed.has(contact.key))
            .map((contact) => contact.values.map(csvCell).join(",")),
        ].join("\r\n") + "\r\n"
      );
    },
    async recordExport(
      actorId: string,
      purpose: "research" | "requested_help" | "marketing",
      rows: number,
      releaseId: string | null = null,
    ) {
      identity(actorId);
      if (
        !Number.isSafeInteger(rows) ||
        rows < 0 ||
        rows > 10_000 ||
        (releaseId !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(releaseId))
      )
        throw new ResearchServiceError();
      if (
        (await rpc("grader_research_record_export", {
          p_actor: actorId,
          p_purpose: purpose,
          p_release_id: releaseId,
          p_rows: rows,
        })) !== true
      )
        throw new ResearchServiceError();
    },
  };
}
export function researchPseudonym(workspaceId: string): string {
  const secret = process.env.SCAN_HASH_SECRET;
  if (!secret || secret.length < 32) throw new ResearchServiceError();
  return createHmac("sha256", secret)
    .update(`grader-research-workspace-v1:${workspaceId}`)
    .digest("hex");
}
export const researchStore = () =>
  createResearchStore({
    rpc: accountRpc,
    activeConfig: getActiveConfig,
    pseudonym: researchPseudonym,
    verifiedEmail: async (id) => {
      const { data, error } =
        await accountAdminClient().auth.admin.getUserById(id);
      if (error) {
        if (error.status === 404) return null;
        throw new ResearchServiceError();
      }
      return data.user?.id === id &&
        data.user.email_confirmed_at &&
        data.user.email
        ? data.user.email
        : null;
    },
  });
export { researchCsv, RESEARCH_LIMITATIONS, RESEARCH_POLICY_VERSION };
export function researchErrorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof ResearchServiceError
          ? error.message
          : "This service is temporarily unavailable.",
      code:
        error instanceof ResearchServiceError
          ? error.code
          : "research_unavailable",
    },
    {
      status: error instanceof ResearchServiceError ? error.status : 503,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
