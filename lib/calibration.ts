import {
  accountRecord,
  accountUuid,
  parseAccountReport,
} from "./account/validation";
import { decodeOutcomePlan, type OutcomePlan } from "./outcome-plans";
import { assessPractice } from "./scoring";
import { parseOutcomePeriodInput } from "./outcomes";
import {
  DOMAIN_IDS,
  type DomainId,
  type ReleaseSnapshot,
  type FeeModel,
  type PracticeStage,
} from "./types";

export const CALIBRATION_VERSION =
  "preregistered-and-retrospective-owner-outcomes-v2";
export const CALIBRATION_MIN_WORKSPACES = 30;
export const CALIBRATION_MIN_CELL = 5;
export const CALIBRATION_MIN_EXPERIMENT = 100;
export const CALIBRATION_CURRENCIES = [
  "USD",
  "CAD",
  "GBP",
  "EUR",
  "AUD",
  "NZD",
  "INR",
] as const;
export const CALIBRATION_SOURCES = ["self_reported", "export"] as const;
export const CALIBRATION_METRICS = [
  "inquiry_client_fraction",
  "billed_collection_fraction",
  "owner_admin_hours_day",
] as const;
export type CalibrationMetric = (typeof CALIBRATION_METRICS)[number];
export type CalibrationWeights = Record<DomainId, number>;
export type CalibrationReason =
  | "no_consent"
  | "invalid_record"
  | "no_baseline"
  | "baseline_after_start"
  | "stale_baseline"
  | "incomparable_period"
  | "different_release"
  | "insufficient_evidence"
  | "no_closed_period";
export interface CalibrationSource {
  workspaceId: string;
  benchmarking: boolean;
  outcomeResearch: boolean;
  periods: unknown[];
  baselines: {
    id: string;
    savedAt: string;
    report: unknown;
    contentHash?: string;
  }[];
  plans?: unknown[];
}
export interface CalibrationPair {
  /** Server-only opaque, purpose-bound HMAC. Never serialize a pair to the API. */
  workspaceKey: string;
  releaseId: string;
  provenance?: "preregistered" | "retrospective";
  currency: (typeof CALIBRATION_CURRENCIES)[number];
  source: (typeof CALIBRATION_SOURCES)[number];
  stage: PracticeStage;
  feeModel: FeeModel;
  score: number;
  domains: { id: DomainId; score: number | null }[];
  outcomes: Record<CalibrationMetric, number | null>;
}
export interface CalibrationDataset {
  pairs: CalibrationPair[];
  candidateWorkspaces: number;
  excluded: Partial<Record<CalibrationReason, number>>;
  truncated: boolean;
}
const fields = [
  "inquiries",
  "contacted",
  "booked",
  "attended",
  "clients",
  "leadSpendMinor",
  "cohortBilledMinor",
  "cohortCollectedMinor",
  "adminHours",
] as const;
interface Period {
  id: string;
  startDate: string;
  endDate: string;
  source: CalibrationPair["source"];
  currency: CalibrationPair["currency"];
  baselineReportId: string | null;
  inquiries: number | null;
  contacted: number | null;
  booked: number | null;
  attended: number | null;
  clients: number | null;
  leadSpendMinor: number | null;
  cohortBilledMinor: number | null;
  cohortCollectedMinor: number | null;
  adminHours: number | null;
}
function day(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const stamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(stamp) &&
    new Date(stamp).toISOString().slice(0, 10) === value
    ? stamp
    : null;
}
function period(value: unknown, now: Date): Period | null {
  if (!accountRecord(value) || !accountUuid(value.id)) return null;
  try {
    const projected = Object.fromEntries(
      [
        "startDate",
        "endDate",
        "source",
        "currency",
        "baselineReportId",
        ...fields,
      ].map((key) => [key, value[key]]),
    );
    return { id: value.id, ...parseOutcomePeriodInput(projected, now) };
  } catch {
    return null;
  }
}

/** Baseline must really have existed before exposure. Never use the owner's supplied score. */
export function projectCalibrationSource(
  candidate: CalibrationSource,
  release: ReleaseSnapshot,
  pseudonym: (id: string) => string,
  now = new Date(),
):
  | { eligible: true; pair: CalibrationPair }
  | { eligible: false; reason: CalibrationReason } {
  if (candidate.benchmarking !== true || candidate.outcomeResearch !== true)
    return { eligible: false, reason: "no_consent" };
  if (
    !accountUuid(candidate.workspaceId) ||
    !Array.isArray(candidate.periods) ||
    candidate.periods.length > 24 ||
    !Array.isArray(candidate.baselines) ||
    candidate.baselines.length > 24
  )
    return { eligible: false, reason: "invalid_record" };
  if (
    candidate.plans !== undefined &&
    (!Array.isArray(candidate.plans) || candidate.plans.length > 36)
  )
    return { eligible: false, reason: "invalid_record" };
  const plans: Array<OutcomePlan & { baselineContentHash: string }> = [];
  try {
    for (const value of candidate.plans ?? []) {
      const p = decodeOutcomePlan(value);
      if (
        !accountRecord(value) ||
        typeof value.baselineContentHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.baselineContentHash)
      )
        return { eligible: false, reason: "invalid_record" };
      plans.push({ ...p, baselineContentHash: value.baselineContentHash });
    }
  } catch {
    return { eligible: false, reason: "invalid_record" };
  }
  if (
    new Set(plans.map((p) => p.id)).size !== plans.length ||
    new Set(plans.filter((p) => p.outcomeId !== null).map((p) => p.outcomeId))
      .size !== plans.filter((p) => p.outcomeId !== null).length
  )
    return { eligible: false, reason: "invalid_record" };
  const periods = candidate.periods.map((p) => period(p, now));
  if (periods.some((p) => p === null))
    return { eligible: false, reason: "invalid_record" };
  const ordered = (periods as Period[]).sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id),
  );
  if (
    new Set(ordered.map((p) => p.id)).size !== ordered.length ||
    ordered.some((p, i) => i > 0 && p.startDate <= ordered[i - 1].endDate)
  )
    return { eligible: false, reason: "invalid_record" };
  const baselineMap = new Map(
    candidate.baselines.map((baseline) => [baseline.id, baseline]),
  );
  if (
    baselineMap.size !== candidate.baselines.length ||
    candidate.baselines.some(
      (b) => !accountUuid(b.id) || !Number.isFinite(Date.parse(b.savedAt)),
    )
  )
    return { eligible: false, reason: "invalid_record" };
  // A genuine registration takes priority, independent of the measured result.
  // Within each provenance choose the earliest eligible period, even if outcomes are unknown.
  ordered.sort(
    (a, b) =>
      Number(
        plans.some((p) => p.status === "reported" && p.outcomeId === b.id),
      ) -
        Number(
          plans.some((p) => p.status === "reported" && p.outcomeId === a.id),
        ) ||
      a.startDate.localeCompare(b.startDate) ||
      a.id.localeCompare(b.id),
  );
  let reason: CalibrationReason = "no_closed_period";
  const today = new Date(now).toISOString().slice(0, 10);
  for (const p of ordered) {
    if (p.endDate >= today) continue;
    const start = day(p.startDate)!;
    if (day(p.endDate)! < now.getTime() - 366 * 86400000) continue;
    const periodDays = (day(p.endDate)! - start) / 86400000 + 1;
    if (periodDays < 28 || periodDays > 31) {
      reason = "incomparable_period";
      continue;
    }
    const plan = plans.find((plan) => plan.outcomeId === p.id);
    if (
      plan?.status === "withdrawn" ||
      (!plan &&
        plans.some(
          (previous) =>
            previous.status === "withdrawn" &&
            previous.startDate <= p.endDate &&
            previous.endDate >= p.startDate,
        ))
    ) {
      reason = "invalid_record";
      continue;
    }
    if (
      plan &&
      (plan.status !== "reported" ||
        plan.startDate !== p.startDate ||
        plan.endDate !== p.endDate ||
        plan.source !== p.source ||
        plan.currency !== p.currency ||
        plan.baselineReportId !== p.baselineReportId ||
        plan.baselineReleaseId !== release.id ||
        Date.parse(plan.createdAt) >= start ||
        !plan.reportedAt ||
        Date.parse(plan.reportedAt) < day(p.endDate)! + 86400000)
    ) {
      reason = "invalid_record";
      continue;
    }
    const baseline = p.baselineReportId
      ? baselineMap.get(p.baselineReportId)
      : null;
    if (!baseline) {
      reason = "no_baseline";
      continue;
    }
    if (
      !accountRecord(baseline.report) ||
      !accountRecord(baseline.report.assessment)
    ) {
      reason = "invalid_record";
      continue;
    }
    if (baseline.report.assessment.releaseId !== release.id) {
      reason = "different_release";
      continue;
    }
    const assessedAt =
      typeof baseline.report.createdAt === "string"
        ? Date.parse(baseline.report.createdAt)
        : NaN;
    const savedAt = Date.parse(baseline.savedAt);
    if (
      plan &&
      (baseline.contentHash !== plan.baselineContentHash ||
        savedAt > Date.parse(plan.createdAt) ||
        assessedAt > Date.parse(plan.createdAt))
    ) {
      reason = "invalid_record";
      continue;
    }
    if (!Number.isFinite(assessedAt)) {
      reason = "invalid_record";
      continue;
    }
    if (
      savedAt > start ||
      assessedAt > start ||
      savedAt < assessedAt - 300000
    ) {
      reason = "baseline_after_start";
      continue;
    }
    if (assessedAt < start - 90 * 86400000) {
      reason = "stale_baseline";
      continue;
    }
    try {
      const { report } = parseAccountReport(
        { report: baseline.report },
        release,
      );
      const assessment = assessPractice({
        context: report.assessment.contextSnapshot,
        answers: report.assessment.answersSnapshot,
        controls: report.assessment.controlsSnapshot,
        release,
      });
      if (
        assessment.coverage < 0.8 ||
        assessment.overallScore === null ||
        assessment.domains.some((d) => d.status === "incomplete")
      ) {
        reason = "insufficient_evidence";
        continue;
      }
      if (
        plan &&
        (plan.baselineStage !== assessment.contextSnapshot.stage ||
          plan.baselineFeeModel !== assessment.contextSnapshot.feeModel)
      ) {
        reason = "invalid_record";
        continue;
      }
      const fraction = (num: number | null, den: number | null) =>
        num !== null && den !== null && den > 0 ? num / den : null;
      // This earliest eligible pair is retained even if every metric is unknown. Do not cherry-pick later periods.
      return {
        eligible: true,
        pair: {
          workspaceKey: pseudonym(candidate.workspaceId),
          releaseId: release.id,
          provenance: plan ? "preregistered" : "retrospective",
          currency: p.currency,
          source: p.source,
          stage: assessment.contextSnapshot.stage,
          feeModel: assessment.contextSnapshot.feeModel,
          score: assessment.overallScore,
          domains: assessment.domains.map(({ id, score }) => ({ id, score })),
          outcomes: {
            inquiry_client_fraction: fraction(p.clients, p.inquiries),
            billed_collection_fraction: fraction(
              p.cohortCollectedMinor,
              p.cohortBilledMinor,
            ),
            owner_admin_hours_day:
              p.adminHours === null
                ? null
                : p.adminHours / ((day(p.endDate)! - start) / 86400000 + 1),
          },
        },
      };
    } catch {
      reason = "invalid_record";
    }
  }
  return { eligible: false, reason };
}

export function calibrationDataset(
  candidates: CalibrationSource[],
  release: ReleaseSnapshot,
  pseudonym: (id: string) => string,
  now = new Date(),
  truncated = false,
): CalibrationDataset {
  const pairs: CalibrationPair[] = [],
    excluded: CalibrationDataset["excluded"] = {};
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.workspaceId))
      return {
        pairs: [],
        candidateWorkspaces: candidates.length,
        excluded: {},
        truncated: true,
      };
    seen.add(candidate.workspaceId);
    const projected = projectCalibrationSource(
      candidate,
      release,
      pseudonym,
      now,
    );
    if (projected.eligible) pairs.push(projected.pair);
    else excluded[projected.reason] = (excluded[projected.reason] ?? 0) + 1;
  }
  return { pairs, candidateWorkspaces: candidates.length, excluded, truncated };
}

export function calibrationCountBand(
  n: number,
  minimum = CALIBRATION_MIN_CELL,
): string | null {
  return n >= minimum
    ? `${Math.floor(n / 5) * 5}–${Math.floor(n / 5) * 5 + 4}`
    : null;
}
export const calibrationMedian = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const round = (n: number | null, digits = 2) =>
  n === null ? null : Math.round(n * 10 ** digits) / 10 ** digits;
const metrics = {
  inquiry_client_fraction: {
    label: "Inquiries that become retained clients",
    unit: "fraction of a fixed inquiry cohort",
    direction: "Higher can be useful when clients are a good fit",
  },
  billed_collection_fraction: {
    label: "Billed cohort collected",
    unit: "fraction of that period's billed cohort collected by period end",
    direction: "Higher generally improves cash conversion",
  },
  owner_admin_hours_day: {
    label: "Owner administration time",
    unit: "owner hours per calendar day",
    direction: "Lower may support independence; context still matters",
  },
} as const;
const SCORE_BANDS = [
  { id: "0–49", min: 0, max: 50 },
  { id: "50–79", min: 50, max: 80 },
  { id: "80–100", min: 80, max: 101 },
] as const;

function ranks(values: number[]): number[] {
  const sorted = values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value - b.value),
    result = new Array<number>(values.length);
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].value === sorted[i].value) j++;
    const rank = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) result[sorted[k].index] = rank;
    i = j;
  }
  return result;
}
/** Pearson correlation of average ranks, including ties. Constant values are undefined, not zero. */
export function spearmanAssociation(x: number[], y: number[]): number | null {
  if (
    x.length !== y.length ||
    x.length < 2 ||
    [...x, ...y].some((n) => !Number.isFinite(n))
  )
    return null;
  const a = ranks(x),
    b = ranks(y),
    mean = (x.length + 1) / 2;
  let numerator = 0,
    sx = 0,
    sy = 0;
  for (let i = 0; i < a.length; i++) {
    const dx = a[i] - mean,
      dy = b[i] - mean;
    numerator += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  }
  return sx === 0 || sy === 0
    ? null
    : Math.max(-1, Math.min(1, numerator / Math.sqrt(sx * sy)));
}
export function calibrationSplit(workspaceKey: string): "train" | "test" {
  if (!/^[a-f0-9]{64}$/.test(workspaceKey))
    throw new Error("A purpose-bound workspace digest is required.");
  return parseInt(workspaceKey.slice(0, 8), 16) % 100 < 70 ? "train" : "test";
}
export function parseCalibrationWeights(
  value: unknown,
): CalibrationWeights | null {
  if (
    !accountRecord(value) ||
    Object.keys(value).length !== DOMAIN_IDS.length ||
    DOMAIN_IDS.some(
      (id) =>
        typeof value[id] !== "number" ||
        !Number.isFinite(value[id]) ||
        value[id] < 0.1 ||
        value[id] > 100,
    )
  )
    return null;
  return Object.fromEntries(
    DOMAIN_IDS.map((id) => [id, value[id]]),
  ) as CalibrationWeights;
}
function candidateScore(
  pair: CalibrationPair,
  weights: CalibrationWeights,
): number | null {
  const known = pair.domains.filter((d) => d.score !== null);
  return known.length
    ? round(
        known.reduce((sum, d) => sum + d.score! * weights[d.id], 0) /
          known.reduce((sum, d) => sum + weights[d.id], 0),
        1,
      )
    : null;
}

export function calibrationSummary(
  dataset: CalibrationDataset,
  release: ReleaseSnapshot,
  weights?: CalibrationWeights,
) {
  const incomplete =
    dataset.truncated ||
    new Set(dataset.pairs.map((p) => p.workspaceKey)).size !==
      dataset.pairs.length ||
    dataset.pairs.some(
      (p) =>
        p.releaseId !== release.id ||
        (p.provenance !== undefined &&
          !["preregistered", "retrospective"].includes(p.provenance)) ||
        !/^[a-f0-9]{64}$/.test(p.workspaceKey) ||
        !Number.isFinite(p.score) ||
        p.score < 0 ||
        p.score > 100 ||
        !CALIBRATION_CURRENCIES.includes(p.currency) ||
        !CALIBRATION_SOURCES.includes(p.source) ||
        !["prelaunch", "new", "established"].includes(p.stage) ||
        ![
          "hourly",
          "flat",
          "contingency",
          "subscription",
          "mixed",
          "other",
        ].includes(p.feeModel) ||
        p.domains.length !== DOMAIN_IDS.length ||
        new Set(p.domains.map((d) => d.id)).size !== DOMAIN_IDS.length ||
        p.domains.some(
          (d) =>
            !DOMAIN_IDS.includes(d.id) ||
            (d.score !== null &&
              (!Number.isFinite(d.score) || d.score < 0 || d.score > 100)),
        ) ||
        CALIBRATION_METRICS.some(
          (id) =>
            p.outcomes[id] !== null &&
            (!Number.isFinite(p.outcomes[id]) ||
              p.outcomes[id]! < 0 ||
              p.outcomes[id]! > (id === "owner_admin_hours_day" ? 24 : 1)),
        ),
    );
  const safePairs = incomplete ? [] : dataset.pairs;
  const groups = new Map<string, CalibrationPair[]>();
  for (const pair of safePairs) {
    const key = [
      pair.provenance ?? "retrospective",
      pair.currency,
      pair.source,
      pair.stage,
      pair.feeModel,
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), pair]);
  }
  const cohorts = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([, members]) => members.length >= 30)
    .map(([, members]) => {
      const { currency, source, stage, feeModel } = members[0];
      return {
        provenance: members[0].provenance ?? "retrospective",
        provenanceLabel:
          members[0].provenance === "preregistered"
            ? "Registered before the period began"
            : "Retrospective link to an earlier baseline",
        currency,
        source,
        stage,
        feeModel,
        sourceLabel:
          source === "export"
            ? "Export-informed owner reports (not independently verified)"
            : "Owner-entered figures",
        workspaces: calibrationCountBand(members.length, 30),
        metrics: CALIBRATION_METRICS.map((id) => {
          const known = members.filter((p) => p.outcomes[id] !== null);
          const enough = known.length >= 30;
          const bandData = SCORE_BANDS.map((band) => {
            const matches = known.filter(
              (p) => p.score >= band.min && p.score < band.max,
            );
            return {
              scoreBand: band.id,
              workspaces: enough ? calibrationCountBand(matches.length) : null,
              medianOutcome:
                enough && matches.length >= 5
                  ? round(
                      calibrationMedian(matches.map((p) => p.outcomes[id]!)),
                      id === "owner_admin_hours_day" ? 1 : 3,
                    )
                  : null,
            };
          });
          const train = known.filter(
              (p) => calibrationSplit(p.workspaceKey) === "train",
            ),
            test = known.filter(
              (p) => calibrationSplit(p.workspaceKey) === "test",
            );
          const ready =
            known.length >= 100 && train.length >= 70 && test.length >= 30;
          const comparison = (group: CalibrationPair[]) => ({
            workspaces: calibrationCountBand(group.length, 30),
            currentAssociation: round(
              spearmanAssociation(
                group.map((p) => p.score),
                group.map((p) => p.outcomes[id]!),
              ),
            ),
            candidateAssociation: weights
              ? round(
                  spearmanAssociation(
                    group.map((p) => candidateScore(p, weights)!),
                    group.map((p) => p.outcomes[id]!),
                  ),
                )
              : null,
          });
          return {
            id,
            ...metrics[id],
            status: enough ? ("descriptive" as const) : ("forming" as const),
            knownWorkspaces: enough
              ? calibrationCountBand(known.length, 30)
              : null,
            missingWorkspaces:
              members.length >= 30
                ? calibrationCountBand(members.length - known.length)
                : null,
            medianOutcome: enough
              ? round(
                  calibrationMedian(known.map((p) => p.outcomes[id]!)),
                  id === "owner_admin_hours_day" ? 1 : 3,
                )
              : null,
            rankAssociation: enough
              ? round(
                  spearmanAssociation(
                    known.map((p) => p.score),
                    known.map((p) => p.outcomes[id]!),
                  ),
                )
              : null,
            scoreBands: bandData,
            candidate: {
              status: ready
                ? weights
                  ? ("exploratory" as const)
                  : ("ready" as const)
                : ("forming" as const),
              train: ready ? comparison(train) : null,
              test: ready ? comparison(test) : null,
            },
          };
        }),
      };
    });
  const descriptive = cohorts.some((c) =>
    c.metrics.some((m) => m.status === "descriptive"),
  );
  return {
    methodologyVersion: CALIBRATION_VERSION,
    status: incomplete
      ? ("incomplete" as const)
      : descriptive
        ? ("descriptive" as const)
        : ("forming" as const),
    releaseId: release.id,
    releaseLabel: release.label,
    currentWeights: Object.fromEntries(
      release.domains.map((d) => [d.id, d.weight]),
    ) as CalibrationWeights,
    minimumWorkspaces: 30,
    minimumScoreBand: 5,
    minimumCandidatePairs: 100,
    eligibleWorkspaces: calibrationCountBand(safePairs.length, 30),
    sourceWorkspaces: incomplete
      ? null
      : calibrationCountBand(dataset.candidateWorkspaces, 30),
    dataQuality:
      incomplete || dataset.candidateWorkspaces < 30
        ? []
        : (
            [
              "no_consent",
              "invalid_record",
              "no_baseline",
              "baseline_after_start",
              "stale_baseline",
              "incomparable_period",
              "different_release",
              "insufficient_evidence",
              "no_closed_period",
            ] as CalibrationReason[]
          ).map((reason) => ({
            reason,
            workspaces: calibrationCountBand(dataset.excluded[reason] ?? 0),
          })),
    cohorts,
    evidenceTracks: (["preregistered", "retrospective"] as const).map(
      (provenance) => ({
        provenance,
        status: incomplete
          ? "incomplete"
          : cohorts.some(
                (c) =>
                  c.provenance === provenance &&
                  c.metrics.some((m) => m.status === "descriptive"),
              )
            ? "descriptive"
            : "forming",
        eligibleWorkspaces: calibrationCountBand(
          safePairs.filter(
            (p) => (p.provenance ?? "retrospective") === provenance,
          ).length,
          30,
        ),
      }),
    ),
    candidateWeights: weights ?? null,
    gradeChangesEnabled: false,
    explanation: incomplete
      ? "The bounded source read was incomplete or inconsistent. No associations, counts, or candidate comparisons are published from a partial extract."
      : descriptive
        ? "Exploratory associations between an earlier readiness score and later owner-reported business outcomes. These are not causal effects or validated predictions."
        : "The outcome evidence is still forming. No result is fabricated, and missing observations are not zero. At least 30 known independent workspaces per fixed currency/source metric are needed.",
    limitations: [
      "Workspaces are not independently verified law firms; more than one account can belong to one practice. Self-selected owner reports are not representative industry evidence. Minimum sample gates are privacy/readiness rules, not statistical-power guarantees.",
      "Both current assessment-benchmarking and separate outcome-research permissions are required. A permission change is rechecked before each analysis.",
      "One pair per workspace: the earliest eligible preregistered period takes priority; otherwise the earliest eligible retrospective period. Missing values are not replaced with a later, more favorable period. As prospective evidence develops, retrospective cohort membership changes, so these are not stable longitudinal cohorts.",
      "Monthly-window pilot: only closed 28–31-day periods ending in the last 366 days. Other durations remain useful private tracking records but do not enter calibration.",
      "Baseline assessed and saved before the outcome period started, at most 90 days earlier; same published scoring release; at least 80% assessment coverage.",
      "Prospective registrations lock an owned canonical baseline, dates, source, currency and context before the first UTC day begins, with an immutable server timestamp and baseline content hash. Outcome figures are still owner reported after the period and can be corrected. A registration is not a controlled experiment or proof of causation. Retrospective links stay in a separate evidence track.",
      "Prospective and retrospective evidence tracks, currency, source, baseline practice stage and fee-model groups are never pooled. Export-informed figures are still owner reports, not verified integrations. Practice area, selection and missingness can confound comparisons.",
      "Medians are per-workspace outcomes, not ratios of pooled dollar or inquiry totals. Score bands describe readiness points, not legal quality or client outcomes.",
      "Spearman rank association uses average ranks for ties. Constant scores or outcomes have undefined association, shown as unavailable. No p-values, causal estimates or automatic weight changes are produced.",
      "Candidate weights are an in-memory sensitivity check, not a trained model. A stable workspace digest assigns roughly 70% to development and 30% to held-out comparison; each metric needs at least 100 pairs, 70 development and 30 held-out workspaces.",
      "Candidate changes affect only the six module weights. Published question weights, applicability rules and evidence eligibility remain fixed, and issued assessments are unchanged.",
      "Repeatedly tuning candidates after inspecting held-out results contaminates that holdout. Any proposed change still needs fresh prospective validation and the existing reviewed release publication workflow.",
      "All cohort counts are suppressed below 30; score-band and diagnostic cells below 5 are suppressed. Displayed counts are bands of five; no individual records leave the server.",
    ],
    methodsSources: [
      {
        title: "NIST · Rank correlation and tied ranks",
        url: "https://www.itl.nist.gov/div898/software/dataplot/refman1/auxillar/rankcorr.htm",
      },
      {
        title: "scikit-learn · Data leakage and held-out evaluation",
        url: "https://scikit-learn.org/stable/common_pitfalls.html",
      },
    ],
  };
}
export type CalibrationSummary = ReturnType<typeof calibrationSummary>;
