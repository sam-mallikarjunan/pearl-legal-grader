import { randomBytes } from "node:crypto";
import type { CloudReport } from "../account/types";
import {
  accountRecord,
  accountUuid,
  validRevision,
} from "../account/validation";
import {
  LEADERBOARD_CONSENT_TEXT,
  LEADERBOARD_POLICY_VERSION,
  leaderboardAliasValid,
  leaderboardEligibility,
  parseLeaderboardPublish,
  publicLeaderboard,
  type LeaderboardCandidate,
  type LeaderboardEnrollment,
} from "../leaderboard";
import { accountRpc } from "./account-db";
import { listAccountReports, readAccountReport } from "./account-store";
import { getActiveConfig } from "./config-store";

if (typeof window !== "undefined")
  throw new Error("Leaderboard persistence is server-only.");
export class LeaderboardServiceError extends Error {
  constructor(
    public readonly status = 503,
    public readonly code = "leaderboard_unavailable",
    message = "The leaderboard is temporarily unavailable. Please try again.",
  ) {
    super(message);
    this.name = "LeaderboardServiceError";
  }
}
function check(value: unknown): unknown {
  if (!accountRecord(value) || typeof value.error !== "string") return value;
  const errors: Record<string, [number, string]> = {
    not_found: [404, "Choose a report saved in your own private workspace."],
    revision_conflict: [
      409,
      "Your public sharing choice changed. Refresh before saving.",
    ],
    release_conflict: [
      409,
      "The published rubric changed. Create a new report before publishing.",
    ],
    ineligible_report: [
      422,
      "Choose a complete, current report assessed within the last 90 days.",
    ],
    publication_limit: [
      429,
      "You have reached the daily publication-change allowance. Withdrawal is still available.",
    ],
  };
  const error = errors[value.error];
  throw new LeaderboardServiceError(
    error?.[0] ?? 503,
    error ? value.error : "leaderboard_unavailable",
    error?.[1],
  );
}
function enrollment(value: unknown): LeaderboardEnrollment {
  check(value);
  if (
    !accountRecord(value) ||
    typeof value.published !== "boolean" ||
    !(value.alias === null || leaderboardAliasValid(value.alias)) ||
    !(value.reportId === null || accountUuid(value.reportId)) ||
    !validRevision(value.revision) ||
    !(
      value.updatedAt === null ||
      (typeof value.updatedAt === "string" &&
        value.updatedAt.length < 60 &&
        Number.isFinite(Date.parse(value.updatedAt)))
    ) ||
    (value.published && (!value.alias || !value.reportId))
  )
    throw new LeaderboardServiceError();
  return {
    published: value.published,
    alias: value.alias,
    reportId: value.reportId,
    revision: value.revision,
    updatedAt: value.updatedAt,
  } as LeaderboardEnrollment;
}
interface LeaderboardDependencies {
  rpc: typeof accountRpc;
  activeConfig: typeof getActiveConfig;
  reports: (userId: string) => Promise<CloudReport[]>;
  report: (userId: string, reportId: string) => Promise<CloudReport>;
  alias?: () => string;
  now?: () => Date;
}
export function createLeaderboardStore(deps: LeaderboardDependencies) {
  const rpc = async (name: string, args: Record<string, unknown> = {}) =>
    check(await deps.rpc(name, args));
  const identity = (userId: string) => {
    if (!accountUuid(userId)) throw new LeaderboardServiceError();
  };
  return {
    async own(userId: string) {
      identity(userId);
      const active = await deps.activeConfig();
      const state = enrollment(
        await rpc("grader_leaderboard_read_own", { p_user_id: userId }),
      );
      const reports = await deps.reports(userId);
      return {
        enrollment: state,
        eligibleReports: reports.map((report) => {
          const eligible = leaderboardEligibility(
            report.snapshot,
            active.release,
            deps.now?.() ?? new Date(),
          );
          return {
            id: report.id,
            createdAt: report.snapshot.createdAt,
            ...(eligible.eligible
              ? {
                  eligible: true,
                  score: eligible.score,
                  coverage: eligible.coverage,
                  cohortLabel: eligible.cohortLabel,
                }
              : { eligible: false, reason: eligible.reason }),
          };
        }),
        policy: {
          version: LEADERBOARD_POLICY_VERSION,
          consentText: LEADERBOARD_CONSENT_TEXT,
        },
      };
    },
    async exportOwn(userId: string) {
      identity(userId);
      const data = await rpc("grader_leaderboard_export_own", {
        p_user_id: userId,
      });
      if (
        !accountRecord(data) ||
        !Array.isArray(data.consentEvents) ||
        data.consentEvents.length > 1000 ||
        typeof data.historyTruncated !== "boolean"
      )
        throw new LeaderboardServiceError();
      return {
        enrollment: enrollment(data.enrollment),
        consentEvents: data.consentEvents.map((event) => {
          if (
            !accountRecord(event) ||
            !["published", "withdrawn"].includes(event.action as string) ||
            !(event.reportId === null || accountUuid(event.reportId)) ||
            event.consentVersion !== LEADERBOARD_POLICY_VERSION ||
            typeof event.consentText !== "string" ||
            event.consentText.length > 1000 ||
            typeof event.recordedAt !== "string" ||
            !Number.isFinite(Date.parse(event.recordedAt))
          )
            throw new LeaderboardServiceError();
          return {
            action: event.action,
            reportId: event.reportId,
            consentVersion: event.consentVersion,
            consentText: event.consentText,
            recordedAt: event.recordedAt,
          };
        }),
        historyTruncated: data.historyTruncated,
      };
    },
    async publish(userId: string, body: unknown) {
      identity(userId);
      const input = parseLeaderboardPublish(body);
      if (!input)
        throw new LeaderboardServiceError(
          400,
          "invalid_publication",
          "Choose a saved report and explicitly agree to public anonymous publication.",
        );
      const active = await deps.activeConfig();
      const report = await deps.report(userId, input.reportId);
      if (report.id !== input.reportId || report.canonical !== true)
        throw new LeaderboardServiceError(
          404,
          "not_found",
          "Choose a report saved in your own private workspace.",
        );
      const eligible = leaderboardEligibility(
        report.snapshot,
        active.release,
        deps.now?.() ?? new Date(),
      );
      if (!eligible.eligible)
        throw new LeaderboardServiceError(
          422,
          "ineligible_report",
          `This report is not eligible (${eligible.reason.replaceAll("_", " ")}). Create a complete report using the current rubric.`,
        );
      const alias =
        deps.alias?.() ??
        `Practice-${randomBytes(6).toString("hex").toUpperCase()}`;
      if (!leaderboardAliasValid(alias)) throw new LeaderboardServiceError();
      return enrollment(
        await rpc("grader_leaderboard_publish", {
          p_user_id: userId,
          p_report_id: input.reportId,
          p_revision: input.revision,
          p_alias: alias,
          p_release_id: active.release.id,
          p_consent_version: LEADERBOARD_POLICY_VERSION,
          p_consent_text: LEADERBOARD_CONSENT_TEXT,
        }),
      );
    },
    async withdraw(userId: string, body: unknown) {
      identity(userId);
      if (
        !accountRecord(body) ||
        Object.keys(body).some((key) => key !== "revision") ||
        !validRevision(body.revision)
      )
        throw new LeaderboardServiceError(
          400,
          "invalid_revision",
          "Refresh your publication choice before withdrawing.",
        );
      return enrollment(
        await rpc("grader_leaderboard_withdraw", {
          p_user_id: userId,
          p_revision: body.revision,
        }),
      );
    },
    async publicView() {
      const active = await deps.activeConfig();
      const candidates: LeaderboardCandidate[] = [];
      let after: string | null = null,
        truncated = false;
      for (let page = 0; page < 100; page++) {
        const data = await rpc("grader_leaderboard_source_page", {
          p_release_id: active.release.id,
          p_after: after,
          p_limit: 10,
        });
        if (!Array.isArray(data) || data.length > 10)
          throw new LeaderboardServiceError();
        for (const row of data) {
          if (
            !accountRecord(row) ||
            !accountUuid(row.workspaceId) ||
            !accountUuid(row.reportId) ||
            !leaderboardAliasValid(row.alias) ||
            !validRevision(row.revision) ||
            row.published !== true ||
            row.consentVersion !== LEADERBOARD_POLICY_VERSION ||
            !accountRecord(row.report)
          )
            throw new LeaderboardServiceError();
          candidates.push(row as unknown as LeaderboardCandidate);
        }
        if (data.length < 10) break;
        const cursor = (data[data.length - 1] as LeaderboardCandidate)
          .workspaceId;
        if (after && cursor <= after) throw new LeaderboardServiceError();
        after = cursor;
        if (page === 99) truncated = true;
      }
      let permitted = candidates;
      // Recheck the exact selected report/revision immediately before public projection. A withdrawal or replacement during the read never leaks the former selection.
      if (candidates.length) {
        const current = await rpc("grader_leaderboard_current_publications", {
          p_selections: candidates.map((c) => ({
            workspaceId: c.workspaceId,
            reportId: c.reportId,
            revision: c.revision,
          })),
          p_release_id: active.release.id,
        });
        if (!Array.isArray(current) || current.some((id) => !accountUuid(id)))
          throw new LeaderboardServiceError();
        const allowed = new Set(current as string[]);
        permitted = candidates.filter((c) => allowed.has(c.workspaceId));
      }
      const latest = await deps.activeConfig();
      if (
        latest.release.id !== active.release.id ||
        latest.contentHash !== active.contentHash
      )
        throw new LeaderboardServiceError(
          409,
          "release_conflict",
          "The rubric changed. Reload to see the current leaderboard.",
        );
      return publicLeaderboard(
        permitted,
        active.release,
        deps.now?.() ?? new Date(),
        truncated,
      );
    },
  };
}
export const leaderboardStore = () =>
  createLeaderboardStore({
    rpc: accountRpc,
    activeConfig: getActiveConfig,
    reports: listAccountReports,
    report: readAccountReport,
  });
export function leaderboardErrorResponse(error: LeaderboardServiceError) {
  return Response.json(
    { error: error.message, code: error.code },
    {
      status: error.status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
