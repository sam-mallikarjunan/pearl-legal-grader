import { createHash } from "node:crypto";
import { accountRpc } from "./account-db";
import { readAccountReport } from "./account-store";
import { getActiveConfig } from "./config-store";
import {
  accountRecord,
  accountUuid,
  canonicalJson,
  parseAccountReport,
} from "../account/validation";
import {
  OutcomeInputError,
  parseOutcomePeriodInput,
  parseOutcomeRevision,
  type OutcomePeriod,
} from "../outcomes";
import {
  OUTCOME_PLAN_LIMIT,
  decodeOutcomePlan,
  parseOutcomePlanInput,
  parseOutcomePlanReport,
  parseOutcomePlanRevision,
  type OutcomePlan,
} from "../outcome-plans";
if (typeof window !== "undefined")
  throw new Error("Outcome plans are server-only.");
export class OutcomePlanStorageError extends Error {
  readonly code = "outcome_plans_unavailable";
  readonly status = 503;
  constructor() {
    super(
      "Your private outcome plans are temporarily unavailable. Please try again.",
    );
  }
}
const errors: Record<string, [string, number]> = {
  invalid_outcome_plan: [
    "The future registration window changed or is invalid. Refresh and choose a period that has not begun.",
    409,
  ],
  not_found: ["This plan is unavailable in your account.", 404],
  revision_conflict: [
    "This plan changed elsewhere. Refresh before saving.",
    409,
  ],
  outcome_plan_closed: ["This plan was closed and cannot be reopened.", 409],
  outcome_plan_overlap: [
    "This period overlaps an active plan or saved outcome. Choose a separate period.",
    409,
  ],
  outcome_plan_limit: [
    "This account has reached its 36-plan preview allowance. Existing plans and withdrawal remain available.",
    429,
  ],
  outcome_change_limit: [
    "This account has reached its change allowance. Withdrawal and export remain available.",
    429,
  ],
  outcome_period_limit: [
    "Delete an old outcome period before reporting another.",
    429,
  ],
  outcome_plan_baseline_invalid: [
    "Choose an owned canonical report using the current scoring release.",
    409,
  ],
  outcome_plan_release_changed: [
    "The published rubric changed. Refresh and select a current report.",
    409,
  ],
  outcome_plan_not_closed: [
    "Report this period after its last UTC calendar day has ended.",
    409,
  ],
  outcome_plan_frozen: [
    "This planned period has frozen dates, currency, source and baseline. Only its numbers can change.",
    409,
  ],
  outcome_period_overlap: [
    "This plan overlaps an existing saved period. Resolve that period before reporting.",
    409,
  ],
  outcome_plan_request_conflict: [
    "This registration request already has different details. Refresh before trying again.",
    409,
  ],
};
function owner(id: string) {
  if (!accountUuid(id))
    throw new OutcomeInputError(
      "invalid_account",
      "Sign in to manage your private plans.",
      401,
    );
}
function failure(v: unknown) {
  if (accountRecord(v) && typeof v.error === "string") {
    const e = errors[v.error];
    if (e) throw new OutcomeInputError(v.error, e[0], e[1]);
    throw new OutcomePlanStorageError();
  }
}
export function createOutcomePlanStore(d: {
  rpc: typeof accountRpc;
  activeConfig: typeof getActiveConfig;
  readReport: typeof readAccountReport;
  now?: () => Date;
}) {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    try {
      const v = await d.rpc(name, args);
      failure(v);
      return v;
    } catch (e) {
      if (e instanceof OutcomeInputError) throw e;
      if (accountRecord(e) && typeof e.code === "string" && errors[e.code]) {
        const x = errors[e.code];
        throw new OutcomeInputError(e.code, x[0], x[1]);
      }
      throw new OutcomePlanStorageError();
    }
  };
  const read = async (userId: string) => {
    owner(userId);
    const v = await rpc("grader_read_outcome_plans", { p_user_id: userId });
    if (
      !accountRecord(v) ||
      !Array.isArray(v.plans) ||
      v.plans.length > OUTCOME_PLAN_LIMIT
    )
      throw new OutcomePlanStorageError();
    const plans = v.plans.map(decodeOutcomePlan);
    if (
      new Set(plans.map((p) => p.id)).size !== plans.length ||
      new Set(plans.map((p) => p.requestId)).size !== plans.length
    )
      throw new OutcomePlanStorageError();
    return { plans };
  };
  return {
    read,
    async create(userId: string, body: unknown) {
      owner(userId);
      const input = parseOutcomePlanInput(body, d.now?.(), true);
      const existing = (await read(userId)).plans.find(
        (p) => p.requestId === input.requestId,
      );
      if (existing) {
        if (
          existing.startDate !== input.startDate ||
          existing.endDate !== input.endDate ||
          existing.source !== input.source ||
          existing.currency !== input.currency ||
          existing.baselineReportId !== input.baselineReportId ||
          existing.baselineReleaseId !== input.expectedReleaseId
        )
          throw new OutcomeInputError(
            "outcome_plan_request_conflict",
            errors.outcome_plan_request_conflict[0],
            409,
          );
        return existing;
      }
      parseOutcomePlanInput(body, d.now?.());
      const active = await d.activeConfig();
      if (active.release.id !== input.expectedReleaseId)
        throw new OutcomeInputError(
          "outcome_plan_release_changed",
          errors.outcome_plan_release_changed[0],
          409,
        );
      const cloud = await d.readReport(userId, input.baselineReportId);
      const { report } = parseAccountReport(
        { report: cloud.snapshot },
        active.release,
      );
      if (
        cloud.canonical !== true ||
        report.isSample ||
        report.assessment.releaseId !== active.release.id ||
        Date.parse(cloud.savedAt) > (d.now?.() ?? new Date()).getTime()
      )
        throw new OutcomeInputError(
          "outcome_plan_baseline_invalid",
          errors.outcome_plan_baseline_invalid[0],
          409,
        );
      if (
        Date.parse(report.createdAt) <
        Date.parse(`${input.startDate}T00:00:00Z`) - 90 * 86400000
      )
        throw new OutcomeInputError(
          "outcome_plan_baseline_invalid",
          "Choose a baseline assessed within 90 days before the planned period starts.",
          409,
        );
      const hash = createHash("sha256")
        .update(canonicalJson(report))
        .digest("hex");
      return decodeOutcomePlan(
        await rpc("grader_register_outcome_plan", {
          p_user_id: userId,
          p_request: input.requestId,
          p_start: input.startDate,
          p_end: input.endDate,
          p_source: input.source,
          p_currency: input.currency,
          p_baseline: input.baselineReportId,
          p_release: active.release.id,
          p_hash: hash,
        }),
      );
    },
    async withdraw(userId: string, id: string, body: unknown) {
      owner(userId);
      if (!accountUuid(id))
        throw new OutcomeInputError("not_found", errors.not_found[0], 404);
      return decodeOutcomePlan(
        await rpc("grader_withdraw_outcome_plan", {
          p_user_id: userId,
          p_id: id,
          p_revision: parseOutcomePlanRevision(body),
        }),
      );
    },
    async report(userId: string, id: string, body: unknown) {
      owner(userId);
      if (!accountUuid(id))
        throw new OutcomeInputError("not_found", errors.not_found[0], 404);
      const plan = (await read(userId)).plans.find((p) => p.id === id);
      if (!plan)
        throw new OutcomeInputError("not_found", errors.not_found[0], 404);
      const input = parseOutcomePlanReport(body, plan, d.now?.());
      const v = await rpc("grader_report_outcome_plan", {
        p_user_id: userId,
        p_id: id,
        p_revision: input.revision,
        p_values: input.values,
      });
      if (!accountRecord(v) || !accountRecord(v.period))
        throw new OutcomePlanStorageError();
      const next = decodeOutcomePlan(v.plan);
      const { id: pid, revision, createdAt, updatedAt, ...period } = v.period;
      if (
        !accountUuid(pid) ||
        typeof createdAt !== "string" ||
        typeof updatedAt !== "string" ||
        !Number.isFinite(Date.parse(createdAt)) ||
        !Number.isFinite(Date.parse(updatedAt))
      )
        throw new OutcomePlanStorageError();
      const parsed = parseOutcomePeriodInput(period, d.now?.());
      if (
        next.outcomeId !== pid ||
        next.status !== "reported" ||
        next.startDate !== parsed.startDate ||
        next.endDate !== parsed.endDate ||
        next.source !== parsed.source ||
        next.currency !== parsed.currency ||
        next.baselineReportId !== parsed.baselineReportId
      )
        throw new OutcomePlanStorageError();
      return {
        plan: next,
        period: {
          ...parsed,
          id: pid,
          revision: parseOutcomeRevision(revision),
          createdAt,
          updatedAt,
        } as OutcomePeriod,
      };
    },
    async exportOwn(userId: string) {
      owner(userId);
      return rpc("grader_export_outcome_plans", { p_user_id: userId });
    },
  };
}
const store = () =>
  createOutcomePlanStore({
    rpc: accountRpc,
    activeConfig: getActiveConfig,
    readReport: readAccountReport,
  });
export const readOwnOutcomePlans = (id: string) => store().read(id);
export const createOwnOutcomePlan = (id: string, body: unknown) =>
  store().create(id, body);
export const withdrawOwnOutcomePlan = (
  userId: string,
  id: string,
  body: unknown,
) => store().withdraw(userId, id, body);
export const reportOwnOutcomePlan = (
  userId: string,
  id: string,
  body: unknown,
) => store().report(userId, id, body);
export const exportOwnOutcomePlans = (id: string) => store().exportOwn(id);
