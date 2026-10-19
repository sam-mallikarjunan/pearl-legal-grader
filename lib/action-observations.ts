import {
  accountRecord,
  accountUuid,
  canonicalJson,
} from "./account/validation";
import type { CloudReport } from "./account/types";
import type { OutcomePlan } from "./outcome-plans";
import {
  OutcomeInputError,
  OUTCOME_CURRENCIES,
  OUTCOME_SOURCES,
  parseOutcomeRevision,
  outcomePeriodDays,
  type OutcomePeriod,
} from "./outcomes";
import {
  progressObservations,
  progressWindowKind,
  PROGRESS_METRIC_IDS,
  type ProgressMetricId,
  type ProgressObservation,
} from "./progress-insights";

export const ACTION_OBSERVATION_VERSION = "private-action-observation-v1";
export const ACTION_OBSERVATION_LIMIT = 72;
export const ACTION_OBSERVATION_PER_PLAN = 3;
export const ACTION_IMPLEMENTATIONS = [
  "unreported",
  "not_started",
  "started_as_planned",
  "started_late",
  "not_implemented",
  "unsure",
] as const;
export const ACTION_CONFOUNDERS = [
  "none_reported",
  "other_actions",
  "pricing_changed",
  "marketing_changed",
  "staffing_changed",
  "case_mix_changed",
  "time_off",
  "unusual_event",
  "unsure",
] as const;
export const ACTION_CONFOUNDER_LABELS: Record<
  (typeof ACTION_CONFOUNDERS)[number],
  string
> = {
  none_reported: "No other factors reported",
  other_actions: "Other business changes or actions",
  pricing_changed: "Pricing or payment terms changed",
  marketing_changed: "Marketing or lead sources changed",
  staffing_changed: "Staffing or coverage changed",
  case_mix_changed: "Practice or inquiry mix changed",
  time_off: "Time off or unusual working days",
  unusual_event: "Another unusual business event",
  unsure: "Not sure / not reviewed",
};
export const ACTION_METRICS: ReadonlyArray<{
  id: ProgressMetricId;
  label: string;
  direction: "higher" | "lower";
}> = [
  {
    id: "inquiry_conversion",
    label: "Inquiry-to-client percentage",
    direction: "higher",
  },
  {
    id: "invoice_collection",
    label: "Period-issued invoice collection percentage",
    direction: "higher",
  },
  {
    id: "cost_per_client",
    label: "Acquisition spend per retained client",
    direction: "lower",
  },
  {
    id: "owner_admin_hours_day",
    label: "Your administration hours per calendar day",
    direction: "lower",
  },
];
export interface ActionObservationInput {
  requestId: string;
  planId: string;
  planRevision: number;
  actionId: string;
  baselinePeriodId: string;
  baselineRevision: number;
  metricId: ProgressMetricId;
  changeStartDate: string;
  scopeDeclared: boolean;
  confounders: Array<(typeof ACTION_CONFOUNDERS)[number]>;
  version: typeof ACTION_OBSERVATION_VERSION;
}
export interface ActionObservation {
  id: string;
  requestId: string;
  revision: number;
  status: "registered" | "withdrawn";
  planId: string;
  reportId: string | null;
  planRevisionAtRegistration: number;
  action: {
    id: string;
    title: string;
    definitionOfDone: string;
    verification: string;
  };
  context: {
    practiceId: string;
    stage: string;
    feeModel: string;
    practiceArea: string;
    jurisdiction: string;
  };
  window: {
    startDate: string;
    endDate: string;
    source: OutcomePeriod["source"];
    currency: OutcomePeriod["currency"];
    releaseId: string;
  };
  baseline: {
    id: string;
    revision: number;
    startDate: string;
    endDate: string;
    source: OutcomePeriod["source"];
    currency: OutcomePeriod["currency"];
    baselineReportId: string | null;
    observation: ProgressObservation;
  };
  metricId: ProgressMetricId;
  changeStartDate: string;
  scopeDeclared: boolean;
  initialConfounders: Array<(typeof ACTION_CONFOUNDERS)[number]>;
  confounders: Array<(typeof ACTION_CONFOUNDERS)[number]>;
  implementation: (typeof ACTION_IMPLEMENTATIONS)[number];
  implementationRecordedAt: string | null;
  version: typeof ACTION_OBSERVATION_VERSION;
  createdAt: string;
  updatedAt: string;
  withdrawnAt: string | null;
}
export interface ActionObservationView {
  observation: ActionObservation;
  comparison: {
    status:
      | "withdrawn"
      | "plan_unavailable"
      | "baseline_changed"
      | "waiting"
      | "unreported"
      | "unknown"
      | "descriptive";
    baseline: ProgressObservation;
    followup: ProgressObservation | null;
    followupRevision: number | null;
    followupUpdatedAt: string | null;
    delta: number | null;
    direction: "higher" | "lower" | "unchanged" | null;
    concurrentRegistrations: number;
    notes: string[];
  };
}
const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const stamp = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const error = (
  message: string,
  code = "invalid_action_observation",
  status = 400,
) => new OutcomeInputError(code, message, status);
export function parseActionConfounders(
  v: unknown,
): ActionObservationInput["confounders"] {
  if (
    !Array.isArray(v) ||
    v.length < 1 ||
    v.length > ACTION_CONFOUNDERS.length ||
    v.some((x) => !ACTION_CONFOUNDERS.includes(x)) ||
    new Set(v).size !== v.length ||
    (v.length > 1 && (v.includes("none_reported") || v.includes("unsure")))
  )
    throw error(
      "Choose reviewed factors, or choose no factors reported or not sure separately.",
    );
  return [...v].sort() as ActionObservationInput["confounders"];
}
export function parseActionObservationInput(
  v: unknown,
): ActionObservationInput {
  const fields = [
    "requestId",
    "planId",
    "planRevision",
    "actionId",
    "baselinePeriodId",
    "baselineRevision",
    "metricId",
    "changeStartDate",
    "scopeDeclared",
    "confounders",
    "version",
  ];
  if (
    !accountRecord(v) ||
    Object.keys(v).length !== fields.length ||
    fields.some((k) => !(k in v)) ||
    !accountUuid(v.requestId) ||
    !accountUuid(v.planId) ||
    !accountUuid(v.baselinePeriodId) ||
    typeof v.actionId !== "string" ||
    !/^[a-z0-9_-]{1,100}$/.test(v.actionId) ||
    !PROGRESS_METRIC_IDS.includes(v.metricId as never) ||
    !date(v.changeStartDate) ||
    typeof v.scopeDeclared !== "boolean" ||
    v.version !== ACTION_OBSERVATION_VERSION
  )
    throw error(
      "Choose an issued action, future plan, known baseline and one fixed measure, and review the private tracking definition.",
    );
  return {
    requestId: v.requestId,
    planId: v.planId,
    planRevision: parseOutcomeRevision(v.planRevision),
    actionId: v.actionId,
    baselinePeriodId: v.baselinePeriodId,
    baselineRevision: parseOutcomeRevision(v.baselineRevision),
    metricId: v.metricId as ProgressMetricId,
    changeStartDate: v.changeStartDate,
    scopeDeclared: v.scopeDeclared,
    confounders: parseActionConfounders(v.confounders),
    version: ACTION_OBSERVATION_VERSION,
  };
}
export function parseActionCheckIn(
  v: unknown,
  changeStartDate: string,
  now = new Date(),
) {
  if (
    !accountRecord(v) ||
    Object.keys(v).length !== 3 ||
    !("revision" in v) ||
    !ACTION_IMPLEMENTATIONS.includes(v.implementation as never)
  )
    throw error(
      "Use the current revision, an implementation choice and predefined factors only.",
    );
  if (
    ["started_as_planned", "started_late"].includes(String(v.implementation)) &&
    now.toISOString().slice(0, 10) < changeStartDate
  )
    throw error(
      "Record a start claim on or after the planned change date, not in advance.",
      "action_observation_not_started",
      409,
    );
  if (
    v.implementation === "started_late" &&
    now.toISOString().slice(0, 10) <= changeStartDate
  )
    throw error(
      "A late start can only be reported after the planned date.",
      "action_observation_not_started",
      409,
    );
  return {
    revision: parseOutcomeRevision(v.revision),
    implementation: v.implementation as ActionObservation["implementation"],
    confounders: parseActionConfounders(v.confounders),
  };
}
export function parseActionWithdrawal(v: unknown) {
  if (!accountRecord(v) || Object.keys(v).length !== 1 || !("revision" in v))
    throw error("Include the current tracking revision.");
  return parseOutcomeRevision(v.revision);
}
export function actionPracticeScope(r: CloudReport) {
  const c = r.snapshot.assessment.contextSnapshot;
  return {
    practiceId: r.snapshot.practiceId,
    stage: c.stage,
    feeModel: c.feeModel,
    practiceArea: c.practiceArea,
    jurisdiction: c.jurisdiction,
  };
}
export function validateActionObservationRegistration(
  input: ActionObservationInput,
  plan: OutcomePlan,
  report: CloudReport,
  baseline: OutcomePeriod,
  baselineReport: CloudReport | null,
  now = new Date(),
) {
  const start = Date.parse(`${plan.startDate}T00:00:00Z`),
    change = Date.parse(`${input.changeStartDate}T00:00:00Z`);
  if (
    plan.id !== input.planId ||
    plan.revision !== input.planRevision ||
    baseline.id !== input.baselinePeriodId ||
    baseline.revision !== input.baselineRevision
  )
    throw error(
      "The plan or baseline changed. Refresh and review them again.",
      "revision_conflict",
      409,
    );
  if (
    plan.status !== "registered" ||
    plan.outcomeId !== null ||
    start <= now.getTime() ||
    change <= now.getTime() ||
    change > start ||
    progressWindowKind(plan) !== "calendar_month"
  )
    throw error(
      "Choose a registered future calendar month and a change date after registration, no later than that month begins.",
      "action_observation_not_prospective",
      409,
    );
  if (
    report.id !== plan.baselineReportId ||
    report.canonical !== true ||
    report.snapshot.isSample ||
    report.snapshot.assessment.releaseId !== plan.baselineReleaseId ||
    Date.parse(report.savedAt) >= start ||
    !report.snapshot.assessment.actions.some((a) => a.id === input.actionId)
  )
    throw error(
      "Choose an action actually issued in this plan’s owned canonical baseline report.",
      "action_observation_action_invalid",
      409,
    );
  if (
    baseline.endDate >= now.toISOString().slice(0, 10) ||
    baseline.endDate >= input.changeStartDate ||
    baseline.source !== plan.source ||
    baseline.currency !== plan.currency ||
    progressWindowKind(baseline) !== "calendar_month" ||
    Date.parse(baseline.createdAt) > now.getTime() ||
    Date.parse(baseline.updatedAt) > now.getTime()
  )
    throw error(
      "Use a known closed calendar month with the same source and currency, saved before registration.",
      "action_observation_baseline_invalid",
      409,
    );
  if (baseline.baselineReportId === null) {
    if (!input.scopeDeclared)
      throw error(
        "Separately confirm that this unlinked baseline describes the selected practice and definitions.",
        "action_observation_scope_required",
        409,
      );
  } else if (
    !baselineReport ||
    baselineReport.id !== baseline.baselineReportId ||
    baselineReport.canonical !== true ||
    baselineReport.snapshot.isSample ||
    canonicalJson(actionPracticeScope(baselineReport)) !==
      canonicalJson(actionPracticeScope(report))
  )
    throw error(
      "The baseline period is linked to a different or unavailable practice scope.",
      "action_observation_baseline_invalid",
      409,
    );
  const observation = progressObservations(baseline)[input.metricId];
  if (observation.value === null)
    throw error(
      "Choose a baseline where the target numerator and denominator are known and the denominator is positive.",
      "action_observation_baseline_unknown",
      409,
    );
  return observation;
}
function metric(v: unknown): ProgressObservation {
  if (
    !accountRecord(v) ||
    !(
      v.value === null ||
      (typeof v.value === "number" && Number.isFinite(v.value))
    ) ||
    !(
      v.numerator === null ||
      (typeof v.numerator === "number" && Number.isFinite(v.numerator))
    ) ||
    !(
      v.denominator === null ||
      (typeof v.denominator === "number" && Number.isFinite(v.denominator))
    ) ||
    !(
      v.reason === null ||
      (typeof v.reason === "string" && v.reason.length < 300)
    )
  )
    throw error(
      "The saved metric is inconsistent.",
      "action_observations_unavailable",
      503,
    );
  return {
    value: v.value as number | null,
    numerator: v.numerator as number | null,
    denominator: v.denominator as number | null,
    reason: v.reason as string | null,
  };
}
export function decodeActionObservation(v: unknown): ActionObservation {
  if (
    !accountRecord(v) ||
    !accountUuid(v.id) ||
    !accountUuid(v.requestId) ||
    !accountUuid(v.planId) ||
    !(v.reportId === null || accountUuid(v.reportId)) ||
    !accountRecord(v.action) ||
    typeof v.action.id !== "string" ||
    typeof v.action.title !== "string" ||
    typeof v.action.definitionOfDone !== "string" ||
    typeof v.action.verification !== "string" ||
    !accountRecord(v.context) ||
    !["practiceId", "stage", "feeModel", "practiceArea", "jurisdiction"].every(
      (k) => typeof (v.context as Record<string, unknown>)[k] === "string",
    ) ||
    !accountRecord(v.window) ||
    !date(v.window.startDate) ||
    !date(v.window.endDate) ||
    !OUTCOME_SOURCES.includes(v.window.source as never) ||
    !OUTCOME_CURRENCIES.includes(v.window.currency as never) ||
    typeof v.window.releaseId !== "string" ||
    progressWindowKind(v.window as unknown as OutcomePeriod) !==
      "calendar_month" ||
    !accountRecord(v.baseline) ||
    !accountUuid(v.baseline.id) ||
    !date(v.baseline.startDate) ||
    !date(v.baseline.endDate) ||
    !(
      v.baseline.baselineReportId === null ||
      accountUuid(v.baseline.baselineReportId)
    ) ||
    !PROGRESS_METRIC_IDS.includes(v.metricId as never) ||
    !date(v.changeStartDate) ||
    typeof v.scopeDeclared !== "boolean" ||
    !ACTION_IMPLEMENTATIONS.includes(v.implementation as never) ||
    !["registered", "withdrawn"].includes(String(v.status)) ||
    v.version !== ACTION_OBSERVATION_VERSION ||
    !stamp(v.createdAt) ||
    !stamp(v.updatedAt) ||
    !(
      v.implementationRecordedAt === null || stamp(v.implementationRecordedAt)
    ) ||
    !(v.withdrawnAt === null || stamp(v.withdrawnAt))
  )
    throw error(
      "Private action tracking could not be read safely.",
      "action_observations_unavailable",
      503,
    );
  const baseline = metric(v.baseline.observation);
  if (
    baseline.value === null ||
    baseline.numerator === null ||
    baseline.numerator < 0 ||
    baseline.reason !== null ||
    progressWindowKind(v.baseline as unknown as OutcomePeriod) !==
      "calendar_month" ||
    (v.baseline.baselineReportId === null && !v.scopeDeclared) ||
    Date.parse(v.updatedAt) < Date.parse(v.createdAt) ||
    baseline.denominator === null ||
    baseline.denominator <= 0 ||
    Date.parse(v.createdAt) >= Date.parse(`${v.changeStartDate}T00:00:00Z`) ||
    v.changeStartDate > v.window.startDate ||
    v.baseline.endDate >= v.createdAt.slice(0, 10) ||
    v.baseline.source !== v.window.source ||
    v.baseline.currency !== v.window.currency ||
    (v.status === "withdrawn" && !v.withdrawnAt)
  )
    throw error(
      "Private action tracking lineage is inconsistent.",
      "action_observations_unavailable",
      503,
    );
  const scale =
    v.metricId === "inquiry_conversion" || v.metricId === "invoice_collection"
      ? 100
      : 1;
  const expected =
    Math.round(
      (baseline.numerator! / baseline.denominator!) * scale * 1000000,
    ) / 1000000;
  if (
    Math.abs(expected - baseline.value!) > 0.000001 ||
    (scale === 100 && baseline.numerator! > baseline.denominator!) ||
    (v.metricId === "owner_admin_hours_day" &&
      baseline.denominator !==
        outcomePeriodDays(v.baseline.startDate, v.baseline.endDate))
  )
    throw error(
      "The frozen metric does not match its numerator and denominator.",
      "action_observations_unavailable",
      503,
    );
  return {
    id: v.id,
    requestId: v.requestId,
    planId: v.planId,
    reportId: v.reportId,
    revision: parseOutcomeRevision(v.revision),
    status: v.status,
    planRevisionAtRegistration: parseOutcomeRevision(
      v.planRevisionAtRegistration,
    ),
    action: {
      id: v.action.id,
      title: v.action.title,
      definitionOfDone: v.action.definitionOfDone,
      verification: v.action.verification,
    },
    context: Object.fromEntries(
      ["practiceId", "stage", "feeModel", "practiceArea", "jurisdiction"].map(
        (k) => [k, (v.context as Record<string, unknown>)[k]],
      ),
    ),
    window: {
      startDate: v.window.startDate,
      endDate: v.window.endDate,
      source: v.window.source,
      currency: v.window.currency,
      releaseId: v.window.releaseId,
    },
    baseline: {
      id: v.baseline.id,
      revision: parseOutcomeRevision(v.baseline.revision),
      startDate: v.baseline.startDate,
      endDate: v.baseline.endDate,
      source: v.baseline.source,
      currency: v.baseline.currency,
      baselineReportId: v.baseline.baselineReportId,
      observation: baseline,
    },
    metricId: v.metricId,
    changeStartDate: v.changeStartDate,
    scopeDeclared: v.scopeDeclared,
    initialConfounders: parseActionConfounders(v.initialConfounders),
    confounders: parseActionConfounders(v.confounders),
    implementation: v.implementation,
    implementationRecordedAt: v.implementationRecordedAt,
    version: ACTION_OBSERVATION_VERSION,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    withdrawnAt: v.withdrawnAt,
  } as ActionObservation;
}
export function actionObservationInputMatches(
  o: ActionObservation,
  i: ActionObservationInput,
) {
  return (
    o.requestId === i.requestId &&
    o.planId === i.planId &&
    o.planRevisionAtRegistration === i.planRevision &&
    o.action.id === i.actionId &&
    o.baseline.id === i.baselinePeriodId &&
    o.baseline.revision === i.baselineRevision &&
    o.metricId === i.metricId &&
    o.changeStartDate === i.changeStartDate &&
    o.scopeDeclared === i.scopeDeclared &&
    canonicalJson(o.initialConfounders) === canonicalJson(i.confounders)
  );
}
export function buildActionObservationView(
  o: ActionObservation,
  plan: OutcomePlan | null,
  baseline: OutcomePeriod | null,
  followup: OutcomePeriod | null,
  concurrentRegistrations = 0,
  now = new Date(),
): ActionObservationView {
  const comparison: ActionObservationView["comparison"] = {
    status: "waiting",
    baseline: o.baseline.observation,
    followup: null,
    followupRevision: null,
    followupUpdatedAt: null,
    delta: null,
    direction: null,
    concurrentRegistrations,
    notes: [
      "This is a before-and-after observation in one practice, without an untreated comparison. It cannot establish that the action caused a change, statistical significance or guaranteed savings.",
      "Implementation and factor check-ins are your claims. A completed action or an editable progress date is not independent verification.",
    ],
  };
  const result = { observation: o, comparison };
  if (o.scopeDeclared && o.baseline.baselineReportId === null)
    comparison.notes.push(
      "You explicitly declared the unlinked baseline to be this practice. That match is not independently verified; no baseline or research permission was changed.",
    );
  if (concurrentRegistrations > 0)
    comparison.notes.push(
      `${concurrentRegistrations} other action registration(s) share this follow-up window. Their separate contributions cannot be isolated, including registrations later withdrawn.`,
    );
  if (o.confounders.length !== 1 || o.confounders[0] !== "none_reported")
    comparison.notes.push(
      `Reported or uncertain influences: ${o.confounders.map((c) => ACTION_CONFOUNDER_LABELS[c]).join(", ")}.`,
    );
  if (o.status === "withdrawn") {
    comparison.status = "withdrawn";
    return result;
  }
  if (
    !plan ||
    !o.reportId ||
    plan.status === "withdrawn" ||
    plan.baselineReportId !== o.reportId ||
    plan.startDate !== o.window.startDate ||
    plan.endDate !== o.window.endDate ||
    plan.source !== o.window.source ||
    plan.currency !== o.window.currency ||
    plan.baselineReleaseId !== o.window.releaseId
  ) {
    comparison.status = "plan_unavailable";
    comparison.notes.push(
      "The registered plan/report was withdrawn, removed or changed. No other window is substituted.",
    );
    return result;
  }
  if (
    !baseline ||
    baseline.id !== o.baseline.id ||
    baseline.revision !== o.baseline.revision ||
    baseline.startDate !== o.baseline.startDate ||
    baseline.endDate !== o.baseline.endDate ||
    baseline.source !== o.baseline.source ||
    baseline.currency !== o.baseline.currency ||
    baseline.baselineReportId !== o.baseline.baselineReportId ||
    canonicalJson(progressObservations(baseline)[o.metricId]) !==
      canonicalJson(o.baseline.observation)
  ) {
    comparison.status = "baseline_changed";
    comparison.notes.push(
      "The original baseline was removed or revised. Its frozen registration record is historical; no comparison is calculated against changed data.",
    );
    return result;
  }
  if (plan.endDate >= now.toISOString().slice(0, 10)) {
    comparison.status = "waiting";
    return result;
  }
  if (plan.status !== "reported" || !plan.outcomeId) {
    comparison.status = "unreported";
    return result;
  }
  if (
    !followup ||
    followup.id !== plan.outcomeId ||
    followup.startDate !== o.window.startDate ||
    followup.endDate !== o.window.endDate ||
    followup.source !== o.window.source ||
    followup.currency !== o.window.currency ||
    followup.baselineReportId !== o.reportId
  ) {
    comparison.status = "unknown";
    comparison.notes.push(
      "The exact registered follow-up is missing or incompatible. No favorable later period is chosen.",
    );
    return result;
  }
  const observed = progressObservations(followup)[o.metricId];
  comparison.followup = observed;
  comparison.followupRevision = followup.revision;
  comparison.followupUpdatedAt = followup.updatedAt;
  if (observed.value === null) {
    comparison.status = "unknown";
    comparison.notes.push(
      observed.reason || "The follow-up metric is unknown.",
    );
    return result;
  }
  comparison.status = "descriptive";
  comparison.delta =
    Math.round((observed.value - o.baseline.observation.value!) * 1000000) /
    1000000;
  comparison.direction =
    comparison.delta > 0
      ? "higher"
      : comparison.delta < 0
        ? "lower"
        : "unchanged";
  comparison.notes.push(
    `The follow-up is revision ${followup.revision}, last changed ${followup.updatedAt}. Numeric corrections can change this view; the registration and baseline snapshot remain fixed.`,
  );
  if (o.implementation !== "started_as_planned")
    comparison.notes.push(
      "The action was not reported as starting as planned, or its implementation remains uncertain. Do not attribute these figures to completion.",
    );
  return result;
}
