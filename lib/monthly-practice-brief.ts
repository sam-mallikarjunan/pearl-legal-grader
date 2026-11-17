import {
  ACTION_OBSERVATION_LIMIT,
  buildActionObservationView,
  type ActionObservation,
  type ActionObservationView,
} from "./action-observations";
import {
  AccountDataError,
  accountRecord,
  accountUuid,
} from "./account/validation";
import type { OutcomePlan } from "./outcome-plans";
import type { OutcomePeriod } from "./outcomes";
import type { ProgressObservation } from "./progress-insights";

export const MONTHLY_BRIEF_VERSION = "monthly-practice-brief-v1";
export const MONTHLY_BRIEF_DECISIONS = [
  "keep",
  "adjust",
  "stop",
  "need_more_data",
] as const;
export type MonthlyBriefChoice = (typeof MONTHLY_BRIEF_DECISIONS)[number];
export type MonthlyBriefStatus = ActionObservationView["comparison"]["status"];
export interface MonthlyBriefEvidence {
  observationRevision: number;
  planRevision: number;
  baselineRevision: number;
  followupId: string | null;
  followupRevision: number | null;
}
export interface MonthlyBriefSavedDecision {
  observationId: string;
  choice: MonthlyBriefChoice;
  revision: number;
  evidence: MonthlyBriefEvidence;
  savedAt: string;
}
export interface MonthlyBriefDecision {
  choice: MonthlyBriefChoice;
  revision: number;
  savedAt: string;
  current: boolean;
}
export interface MonthlyBriefDecisionInput {
  observationId: string;
  choice: MonthlyBriefChoice;
  expectedDecisionRevision: number | null;
  evidence: MonthlyBriefEvidence;
}
export interface MonthlyPracticeBrief {
  observationId: string;
  action: Pick<ActionObservation["action"], "id" | "title">;
  window: Omit<ActionObservation["window"], "releaseId">;
  baselineWindow: Pick<OutcomePeriod, "startDate" | "endDate">;
  metricId: ActionObservation["metricId"];
  status: MonthlyBriefStatus;
  baseline: ProgressObservation;
  followup: ProgressObservation | null;
  delta: number | null;
  direction: ActionObservationView["comparison"]["direction"];
  implementation: ActionObservation["implementation"];
  confounders: ActionObservation["confounders"];
  concurrentRegistrations: number;
  availableDecisions: MonthlyBriefChoice[];
  evidence: MonthlyBriefEvidence | null;
  decision: MonthlyBriefDecision | null;
}
export interface MonthlyPracticeBriefResponse {
  version: typeof MONTHLY_BRIEF_VERSION;
  briefs: MonthlyPracticeBrief[];
}
export interface MonthlyBriefActionContext {
  observations: ActionObservation[];
  plans: OutcomePlan[];
  baselines: OutcomePeriod[];
  followups: OutcomePeriod[];
}

const revision = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000;

const exactRecord = (
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> =>
  accountRecord(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const isChoice = (v: unknown): v is MonthlyBriefChoice =>
  typeof v === "string" &&
  MONTHLY_BRIEF_DECISIONS.includes(v as MonthlyBriefChoice);

function briefEvidence(v: unknown): MonthlyBriefEvidence | null {
  if (
    !exactRecord(v, [
      "observationRevision",
      "planRevision",
      "baselineRevision",
      "followupId",
      "followupRevision",
    ]) ||
    !revision(v.observationRevision) ||
    !revision(v.planRevision) ||
    !revision(v.baselineRevision) ||
    !(v.followupId === null || accountUuid(v.followupId)) ||
    !(v.followupRevision === null || revision(v.followupRevision)) ||
    (v.followupId === null) !== (v.followupRevision === null)
  )
    return null;
  return {
    observationRevision: v.observationRevision,
    planRevision: v.planRevision,
    baselineRevision: v.baselineRevision,
    followupId: v.followupId === null ? null : v.followupId.toLowerCase(),
    followupRevision: v.followupRevision,
  };
}

export function parseMonthlyBriefDecision(
  v: unknown,
): MonthlyBriefDecisionInput {
  const invalid = () =>
    new AccountDataError(
      "invalid_monthly_brief_decision",
      "Review this brief and choose a decision using its current figures.",
    );
  if (
    !exactRecord(v, [
      "observationId",
      "choice",
      "expectedDecisionRevision",
      "evidence",
    ]) ||
    !accountUuid(v.observationId) ||
    !isChoice(v.choice) ||
    !(
      v.expectedDecisionRevision === null ||
      revision(v.expectedDecisionRevision)
    )
  )
    throw invalid();
  const evidence = briefEvidence(v.evidence);
  if (!evidence) throw invalid();
  return {
    observationId: v.observationId.toLowerCase(),
    choice: v.choice,
    expectedDecisionRevision: v.expectedDecisionRevision,
    evidence,
  };
}

export function monthlyBriefUnavailable() {
  return new AccountDataError(
    "monthly_practice_brief_unavailable",
    "The practice brief could not be loaded. Try again shortly.",
    503,
  );
}

export function decodeMonthlyBriefSavedDecision(
  v: unknown,
): MonthlyBriefSavedDecision {
  if (
    !exactRecord(v, [
      "observationId",
      "choice",
      "revision",
      "evidence",
      "savedAt",
    ]) ||
    !accountUuid(v.observationId) ||
    !isChoice(v.choice) ||
    !revision(v.revision) ||
    typeof v.savedAt !== "string" ||
    !Number.isFinite(Date.parse(v.savedAt))
  )
    throw monthlyBriefUnavailable();
  const evidence = briefEvidence(v.evidence);
  if (!evidence) throw monthlyBriefUnavailable();
  return {
    observationId: v.observationId.toLowerCase(),
    choice: v.choice,
    revision: v.revision,
    evidence,
    savedAt: v.savedAt,
  };
}

export function decodeMonthlyBriefDecisions(v: unknown) {
  if (
    !exactRecord(v, ["version", "decisions"]) ||
    v.version !== MONTHLY_BRIEF_VERSION ||
    !Array.isArray(v.decisions) ||
    v.decisions.length > ACTION_OBSERVATION_LIMIT
  )
    throw monthlyBriefUnavailable();
  const decisions = v.decisions.map(decodeMonthlyBriefSavedDecision);
  if (new Set(decisions.map((d) => d.observationId)).size !== decisions.length)
    throw monthlyBriefUnavailable();
  return { version: MONTHLY_BRIEF_VERSION, decisions };
}

export function sameMonthlyBriefEvidence(
  a: MonthlyBriefEvidence,
  b: MonthlyBriefEvidence,
) {
  return (
    a.observationRevision === b.observationRevision &&
    a.planRevision === b.planRevision &&
    a.baselineRevision === b.baselineRevision &&
    a.followupId === b.followupId &&
    a.followupRevision === b.followupRevision
  );
}

export function buildMonthlyPracticeBriefs(
  context: MonthlyBriefActionContext,
  decisions: MonthlyBriefSavedDecision[],
  now = new Date(),
): MonthlyPracticeBriefResponse {
  const byId = <T extends { id: string }>(rows: T[]) =>
    new Map(rows.map((row) => [row.id, row]));
  const plans = byId(context.plans);
  const baselines = byId(context.baselines);
  const followups = byId(context.followups);
  const saved = new Map(decisions.map((d) => [d.observationId, d]));
  const counts = new Map<string, number>();
  for (const o of context.observations)
    counts.set(o.planId, (counts.get(o.planId) ?? 0) + 1);
  const briefs = context.observations.map(
    (observation): MonthlyPracticeBrief => {
      const plan = plans.get(observation.planId) ?? null;
      const baseline = baselines.get(observation.baseline.id) ?? null;
      const followup =
        (plan?.outcomeId && followups.get(plan.outcomeId)) || null;
      const { comparison } = buildActionObservationView(
        observation,
        plan,
        baseline,
        followup,
        (counts.get(observation.planId) ?? 1) - 1,
        now,
      );
      const exactFollowup =
        comparison.followupRevision !== null ? followup : null;
      const availableDecisions: MonthlyBriefChoice[] =
        comparison.status === "descriptive" && exactFollowup
          ? [...MONTHLY_BRIEF_DECISIONS]
          : (comparison.status === "unreported" &&
                plan?.status === "registered" &&
                plan.outcomeId === null) ||
              (comparison.status === "unknown" && exactFollowup)
            ? ["need_more_data"]
            : [];
      const evidence: MonthlyBriefEvidence | null =
        availableDecisions.length && plan && baseline
          ? {
              observationRevision: observation.revision,
              planRevision: plan.revision,
              baselineRevision: baseline.revision,
              followupId: exactFollowup?.id ?? null,
              followupRevision: exactFollowup?.revision ?? null,
            }
          : null;
      const prev = saved.get(observation.id);
      return {
        observationId: observation.id,
        action: { id: observation.action.id, title: observation.action.title },
        window: {
          startDate: observation.window.startDate,
          endDate: observation.window.endDate,
          source: observation.window.source,
          currency: observation.window.currency,
        },
        baselineWindow: {
          startDate: observation.baseline.startDate,
          endDate: observation.baseline.endDate,
        },
        metricId: observation.metricId,
        status: comparison.status,
        baseline: comparison.baseline,
        followup: comparison.followup,
        delta: comparison.delta,
        direction: comparison.direction,
        implementation: observation.implementation,
        confounders: observation.confounders,
        concurrentRegistrations: comparison.concurrentRegistrations,
        availableDecisions,
        evidence,
        decision: prev
          ? {
              choice: prev.choice,
              revision: prev.revision,
              savedAt: prev.savedAt,
              current:
                evidence !== null &&
                availableDecisions.includes(prev.choice) &&
                sameMonthlyBriefEvidence(prev.evidence, evidence),
            }
          : null,
      };
    },
  );
  const rank = (b: MonthlyPracticeBrief) =>
    b.availableDecisions.length && !b.decision?.current
      ? 0
      : b.decision?.current
        ? 1
        : b.status === "waiting"
          ? 2
          : 3;
  briefs.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      b.window.endDate.localeCompare(a.window.endDate) ||
      a.observationId.localeCompare(b.observationId),
  );
  return { version: MONTHLY_BRIEF_VERSION, briefs };
}
