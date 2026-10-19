import { accountRecord, accountUuid } from "./account/validation";
import {
  OUTCOME_CURRENCIES,
  OUTCOME_SOURCES,
  OUTCOME_COUNT_FIELDS,
  OUTCOME_MONEY_FIELDS,
  OutcomeInputError,
  outcomePeriodDays,
  parseOutcomePeriodInput,
  parseOutcomeRevision,
  type OutcomePeriodInput,
} from "./outcomes";
import type { PracticeStage, FeeModel } from "./types";
export const OUTCOME_PLAN_LIMIT = 36;
export const OUTCOME_PLAN_VERSION = "future-month-plan-v1";
export const OUTCOME_VALUE_FIELDS = [
  ...OUTCOME_COUNT_FIELDS,
  ...OUTCOME_MONEY_FIELDS,
  "adminHours",
] as const;
export type OutcomeValues = Pick<
  OutcomePeriodInput,
  (typeof OUTCOME_VALUE_FIELDS)[number]
>;
export interface OutcomePlanInput {
  requestId: string;
  expectedReleaseId: string;
  baselineReportId: string;
  startDate: string;
  endDate: string;
  source: OutcomePeriodInput["source"];
  currency: OutcomePeriodInput["currency"];
}
export interface OutcomePlan {
  id: string;
  revision: number;
  requestId: string;
  startDate: string;
  endDate: string;
  source: OutcomePeriodInput["source"];
  currency: OutcomePeriodInput["currency"];
  baselineReportId: string | null;
  baselineReleaseId: string;
  baselineStage: PracticeStage;
  baselineFeeModel: FeeModel;
  status: "registered" | "reported" | "withdrawn";
  outcomeId: string | null;
  createdAt: string;
  updatedAt: string;
  reportedAt: string | null;
  withdrawnAt: string | null;
}
const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export function parseOutcomePlanInput(
  value: unknown,
  now = new Date(),
  existingRetry = false,
): OutcomePlanInput {
  const keys = [
    "requestId",
    "expectedReleaseId",
    "baselineReportId",
    "startDate",
    "endDate",
    "source",
    "currency",
  ];
  if (
    !accountRecord(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !(k in value)) ||
    !accountUuid(value.requestId) ||
    !accountUuid(value.baselineReportId) ||
    typeof value.expectedReleaseId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(value.expectedReleaseId) ||
    !date(value.startDate) ||
    !date(value.endDate) ||
    !OUTCOME_SOURCES.includes(value.source as never) ||
    !OUTCOME_CURRENCIES.includes(value.currency as never)
  )
    throw new OutcomeInputError(
      "invalid_outcome_plan",
      "Choose a saved baseline, source, currency and a future 28–31-day period.",
    );
  const days = outcomePeriodDays(value.startDate, value.endDate);
  if (
    days < 28 ||
    days > 31 ||
    (!existingRetry &&
      (Date.parse(`${value.startDate}T00:00:00Z`) <= now.getTime() ||
        Date.parse(`${value.startDate}T00:00:00Z`) >
          now.getTime() + 366 * 86400000))
  )
    throw new OutcomeInputError(
      "invalid_outcome_plan",
      "Register a 28–31-day period before its first UTC calendar day begins, within the next year.",
    );
  return value as unknown as OutcomePlanInput;
}
export function parseOutcomePlanReport(
  value: unknown,
  plan: OutcomePlan,
  now = new Date(),
): { revision: number; period: OutcomePeriodInput; values: OutcomeValues } {
  if (
    !accountRecord(value) ||
    Object.keys(value).length !== 2 ||
    !("revision" in value) ||
    !accountRecord(value.values) ||
    Object.keys(value.values).some(
      (k) => !OUTCOME_VALUE_FIELDS.includes(k as never),
    )
  )
    throw new OutcomeInputError(
      "invalid_outcome_plan_report",
      "Include the current plan revision and numeric outcome values only.",
    );
  if (plan.status === "withdrawn" || !plan.baselineReportId)
    throw new OutcomeInputError(
      "outcome_plan_closed",
      "This plan was closed. It cannot be reopened or reported.",
      409,
    );
  if (plan.endDate >= now.toISOString().slice(0, 10))
    throw new OutcomeInputError(
      "outcome_plan_not_closed",
      "Report this period after its last UTC calendar day has ended.",
      409,
    );
  const period = parseOutcomePeriodInput(
    {
      startDate: plan.startDate,
      endDate: plan.endDate,
      source: plan.source,
      currency: plan.currency,
      baselineReportId: plan.baselineReportId,
      ...value.values,
    },
    now,
  );
  return {
    revision: parseOutcomeRevision(value.revision),
    period,
    values: Object.fromEntries(
      OUTCOME_VALUE_FIELDS.map((k) => [k, period[k]]),
    ) as OutcomeValues,
  };
}
export function parseOutcomePlanRevision(value: unknown): number {
  if (
    !accountRecord(value) ||
    Object.keys(value).length !== 1 ||
    !("revision" in value)
  )
    throw new OutcomeInputError(
      "invalid_outcome_plan",
      "Include the current plan revision.",
    );
  return parseOutcomeRevision(value.revision);
}
export function decodeOutcomePlan(value: unknown): OutcomePlan {
  const stamp = (v: unknown): v is string =>
    typeof v === "string" && Number.isFinite(Date.parse(v));
  if (
    !accountRecord(value) ||
    !accountUuid(value.id) ||
    !accountUuid(value.requestId) ||
    !date(value.startDate) ||
    !date(value.endDate) ||
    outcomePeriodDays(value.startDate, value.endDate) < 28 ||
    outcomePeriodDays(value.startDate, value.endDate) > 31 ||
    !OUTCOME_SOURCES.includes(value.source as never) ||
    !OUTCOME_CURRENCIES.includes(value.currency as never) ||
    !(value.baselineReportId === null || accountUuid(value.baselineReportId)) ||
    typeof value.baselineReleaseId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(value.baselineReleaseId) ||
    !["prelaunch", "new", "established"].includes(
      value.baselineStage as string,
    ) ||
    ![
      "hourly",
      "flat",
      "contingency",
      "subscription",
      "mixed",
      "other",
    ].includes(value.baselineFeeModel as string) ||
    !["registered", "reported", "withdrawn"].includes(value.status as string) ||
    !(value.outcomeId === null || accountUuid(value.outcomeId)) ||
    !stamp(value.createdAt) ||
    !stamp(value.updatedAt) ||
    !(value.reportedAt === null || stamp(value.reportedAt)) ||
    !(value.withdrawnAt === null || stamp(value.withdrawnAt)) ||
    Date.parse(value.createdAt) >= Date.parse(`${value.startDate}T00:00:00Z`) ||
    (value.status !== "withdrawn" && !value.baselineReportId) ||
    (value.status === "reported" && (!value.outcomeId || !value.reportedAt)) ||
    (value.status === "registered" &&
      (value.outcomeId !== null || value.reportedAt !== null)) ||
    (value.status === "withdrawn" && !value.withdrawnAt)
  )
    throw new OutcomeInputError(
      "invalid_stored_plan",
      "The saved outcome plan is inconsistent.",
      503,
    );
  return {
    id: value.id,
    revision: parseOutcomeRevision(value.revision),
    requestId: value.requestId,
    startDate: value.startDate,
    endDate: value.endDate,
    source: value.source as OutcomePlan["source"],
    currency: value.currency as OutcomePlan["currency"],
    baselineReportId: value.baselineReportId as string | null,
    baselineReleaseId: value.baselineReleaseId,
    baselineStage: value.baselineStage as PracticeStage,
    baselineFeeModel: value.baselineFeeModel as FeeModel,
    status: value.status as OutcomePlan["status"],
    outcomeId: value.outcomeId as string | null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    reportedAt: value.reportedAt as string | null,
    withdrawnAt: value.withdrawnAt as string | null,
  };
}
