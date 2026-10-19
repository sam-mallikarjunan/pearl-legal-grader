import { accountRecord } from "./account/validation";
import {
  projectCalibrationSource,
  calibrationMedian,
  type CalibrationPair,
  type CalibrationSource,
} from "./calibration";
import { DOMAIN_IDS, type ReleaseSnapshot } from "./types";
import {
  PRACTICE_BENCHMARK_VERSION,
  PRACTICE_MAPPING_VERSION,
  PRACTICE_MAPPING_RELEASES,
  PRACTICE_BENCHMARK_MINIMUM,
  PRACTICE_BENCHMARK_CELL_MINIMUM,
  PRACTICE_BENCHMARK_GROUPS,
  PRACTICE_BENCHMARK_METRICS,
  practiceBenchmarkGroup,
  type PracticeBenchmarkGroup,
  type PracticeBenchmarkSummary,
  type PracticeBenchmarkCohort,
} from "./practice-benchmark-types";
export type { PracticeBenchmarkSummary } from "./practice-benchmark-types";
/** Server analysis only. Never send observations or workspace keys to the browser. */
export interface PracticeBenchmarkObservation extends CalibrationPair {
  group: PracticeBenchmarkGroup;
  mappingVersion: string;
  periodStart: string;
  periodEnd: string;
}
export interface PracticeBenchmarkDataset {
  observations: PracticeBenchmarkObservation[];
  incomplete: boolean;
}
function calendarMonth(start: unknown, end: unknown): boolean {
  if (
    typeof start !== "string" ||
    typeof end !== "string" ||
    !/^\d{4}-\d{2}-01$/.test(start)
  )
    return false;
  const parsed = new Date(`${start}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== start
  )
    return false;
  parsed.setUTCMonth(parsed.getUTCMonth() + 1);
  parsed.setUTCDate(0);
  return parsed.toISOString().slice(0, 10) === end;
}
/** Reuse the established canonical-baseline/consent/registration validator, without modifying its scope. */
export function projectPracticeBenchmarkSource(
  candidate: CalibrationSource,
  release: ReleaseSnapshot,
  pseudonym: (id: string) => string,
  now = new Date(),
): PracticeBenchmarkObservation | null {
  if (!PRACTICE_MAPPING_RELEASES.includes(release.id)) return null;
  // Validate the full period/plan structure first: a subset must not conceal malformed, duplicate or overlapping periods.
  const whole = projectCalibrationSource(candidate, release, pseudonym, now);
  if (!whole.eligible) return null;
  const plans = candidate.plans ?? [];
  const reported = (id: unknown) =>
    plans.some(
      (p) => accountRecord(p) && p.status === "reported" && p.outcomeId === id,
    );
  const periods = candidate.periods
    .filter(accountRecord)
    .sort(
      (a, b) =>
        Number(reported(b.id)) - Number(reported(a.id)) ||
        String(a.startDate).localeCompare(String(b.startDate)) ||
        String(a.id).localeCompare(String(b.id)),
    );
  for (const p of periods) {
    if (!calendarMonth(p.startDate, p.endDate)) continue;
    const selected = projectCalibrationSource(
      { ...candidate, periods: [p] },
      release,
      pseudonym,
      now,
    );
    if (!selected.eligible) continue;
    const baseline = candidate.baselines.find(
      (b) => b.id === p.baselineReportId,
    );
    if (
      !baseline ||
      !accountRecord(baseline.report) ||
      !accountRecord(baseline.report.assessment) ||
      !accountRecord(baseline.report.assessment.contextSnapshot)
    )
      return null;
    const group = practiceBenchmarkGroup(
      baseline.report.assessment.contextSnapshot.practiceArea,
    );
    // Keep the first eligible period even when unclassified or outcomes unknown. Never substitute a later favorable result.
    if (!group) return null;
    return {
      ...selected.pair,
      group,
      mappingVersion: PRACTICE_MAPPING_VERSION,
      periodStart: p.startDate as string,
      periodEnd: p.endDate as string,
    };
  }
  return null;
}
export function practiceBenchmarkDataset(
  candidates: CalibrationSource[],
  release: ReleaseSnapshot,
  pseudonym: (id: string) => string,
  now = new Date(),
  incomplete = false,
): PracticeBenchmarkDataset {
  if (
    incomplete ||
    new Set(candidates.map((c) => c.workspaceId)).size !== candidates.length
  )
    return { observations: [], incomplete: true };
  const observations: PracticeBenchmarkObservation[] = [];
  for (const candidate of candidates) {
    const projected = projectPracticeBenchmarkSource(
      candidate,
      release,
      pseudonym,
      now,
    );
    if (projected) observations.push(projected);
  }
  return { observations, incomplete: false };
}
const band = (count: number) =>
  `${Math.floor(count / 10) * 10}–${Math.floor(count / 10) * 10 + 9}`;
const cellBand = (count: number) =>
  `${Math.floor(count / 5) * 5}–${Math.floor(count / 5) * 5 + 4}`;
const rounded = (values: number[], id: string) => {
  const median = calibrationMedian(values)!;
  return id === "owner_admin_hours_day"
    ? Math.round(median * 2) / 2
    : Math.round(median * 20) * 5;
};
const scoreBands = [
  { id: "0–49" as const, min: 0, max: 50 },
  { id: "50–79" as const, min: 50, max: 80 },
  { id: "80–100" as const, min: 80, max: 101 },
];
function validObservation(
  o: PracticeBenchmarkObservation,
  releaseId: string,
  now: Date,
) {
  return (
    o.releaseId === releaseId &&
    o.mappingVersion === PRACTICE_MAPPING_VERSION &&
    PRACTICE_BENCHMARK_GROUPS.some((g) => g.id === o.group) &&
    /^[a-f0-9]{64}$/.test(o.workspaceKey) &&
    calendarMonth(o.periodStart, o.periodEnd) &&
    o.periodEnd < now.toISOString().slice(0, 10) &&
    Date.parse(`${o.periodEnd}T00:00:00.000Z`) >=
      now.getTime() - 366 * 86400000 &&
    ["preregistered", "retrospective"].includes(o.provenance ?? "") &&
    ["prelaunch", "new", "established"].includes(o.stage) &&
    [
      "hourly",
      "flat",
      "contingency",
      "subscription",
      "mixed",
      "other",
    ].includes(o.feeModel) &&
    ["USD", "CAD", "GBP", "EUR", "AUD", "NZD", "INR"].includes(o.currency) &&
    ["self_reported", "export"].includes(o.source) &&
    Number.isFinite(o.score) &&
    o.score >= 0 &&
    o.score <= 100 &&
    o.domains.length === DOMAIN_IDS.length &&
    new Set(o.domains.map((d) => d.id)).size === DOMAIN_IDS.length &&
    o.domains.every(
      (d) =>
        DOMAIN_IDS.includes(d.id) &&
        (d.score === null ||
          (Number.isFinite(d.score) && d.score >= 0 && d.score <= 100)),
    ) &&
    PRACTICE_BENCHMARK_METRICS.every(
      ({ id }) =>
        o.outcomes[id] === null ||
        (Number.isFinite(o.outcomes[id]) &&
          o.outcomes[id]! >= 0 &&
          o.outcomes[id]! <= (id === "owner_admin_hours_day" ? 24 : 1)),
    )
  );
}
export function practiceBenchmarkSummary(
  dataset: PracticeBenchmarkDataset,
  releaseId: string | null,
  now = new Date(),
): PracticeBenchmarkSummary {
  const mappingSupported =
    releaseId !== null && PRACTICE_MAPPING_RELEASES.includes(releaseId);
  const base: PracticeBenchmarkSummary = {
    status: "forming",
    methodologyVersion: PRACTICE_BENCHMARK_VERSION,
    mappingVersion: PRACTICE_MAPPING_VERSION,
    mappingSupported,
    releaseId,
    generatedAt: now.toISOString(),
    minimumKnownWorkspaces: PRACTICE_BENCHMARK_MINIMUM,
    minimumScoreCell: PRACTICE_BENCHMARK_CELL_MINIMUM,
    publicationEnabled: false,
    title: "Practice-specific comparisons are forming",
    explanation: mappingSupported
      ? "No comparable practice group is ready to publish yet. Each metric needs at least 30 distinct consenting workspaces in the exact same practice group, calendar month and comparison scope. Unknown is not zero."
      : "Practice-group mapping is awaiting review for this scoring release. No participant statistic is published.",
    cohorts: [],
    limitations: [
      "Self-selected, owner-reported workspaces, not verified law firms or a representative market sample. Jurisdictions and firm size are not matched; currency is not a proxy for jurisdiction.",
      "Both current assessment-benchmarking and outcome-research permissions are required. Leaderboard, marketing, reminders and requested-help permissions do not grant research access.",
      "One earliest eligible full-calendar-month baseline/outcome pair per workspace in the last 366 days; genuine registered periods take priority. The canonical baseline must predate the period, be at most 90 days old and have at least 80% evidence coverage. Unknown outcomes do not cause substitution of a later period.",
      "Exact practice group, calendar month, registration track, stage, fee model, currency, reporting source, scoring release and analysis mapping are kept separate. Custom areas, Other and blank answers are unclassified and excluded; labels are owner-selected, not verified specializations. The mapping version describes analysis policy, not a recorded capture-form edition.",
      "At least 30 known workspace values per metric. Participant counts are bands of ten, rate medians are rounded to five percentage points, readiness medians to five rubric points, and owner hours/day to half an hour. Medians give each workspace equal weight, rather than pooling its inquiries or invoices.",
      "Readiness-band breakdowns appear only when all three cells have at least five known workspaces; cell counts use bands of five. An omitted breakdown does not imply zero participants.",
      "A readiness score is rubric points, not a conversion percentage or legal-quality rank. These descriptive comparisons establish no causation, significance or predicted outcome and never change saved grades or weights.",
      "Permissions, corrections, deletions and newly registered periods can change the sample. Retrospective contributors can leave that track when a registered period becomes eligible. This is not a stable longitudinal cohort or a verified integration; export means export-informed owner report.",
    ],
  };
  if (
    dataset.incomplete ||
    !mappingSupported ||
    !releaseId ||
    new Set(dataset.observations.map((o) => o.workspaceKey)).size !==
      dataset.observations.length ||
    dataset.observations.some((o) => !validObservation(o, releaseId, now))
  )
    return {
      ...base,
      status: dataset.incomplete ? "unavailable" : "forming",
      title: dataset.incomplete
        ? "Practice comparisons could not be checked"
        : base.title,
      explanation: dataset.incomplete
        ? "The complete comparable dataset could not be checked. No partial sample or peer statistic is published; try again later."
        : base.explanation,
    };
  const groups = new Map<string, PracticeBenchmarkObservation[]>();
  for (const o of dataset.observations) {
    const key = [
      o.group,
      o.periodStart,
      o.periodEnd,
      o.provenance,
      o.stage,
      o.feeModel,
      o.currency,
      o.source,
    ].join("|");
    const members = groups.get(key) ?? [];
    members.push(o);
    groups.set(key, members);
  }
  const cohorts: PracticeBenchmarkCohort[] = [];
  for (const [key, members] of [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (members.length < PRACTICE_BENCHMARK_MINIMUM) continue;
    const metrics = PRACTICE_BENCHMARK_METRICS.map(({ id, unit }) => {
      const known = members.filter((o) => o.outcomes[id] !== null),
        enough = known.length >= PRACTICE_BENCHMARK_MINIMUM;
      const cells = scoreBands.map((b) => ({
        band: b,
        members: known.filter((o) => o.score >= b.min && o.score < b.max),
      }));
      // Suppress every cell when any cell is small; no complement/difference reveals a hidden cell.
      const showCells =
        enough &&
        cells.every((c) => c.members.length >= PRACTICE_BENCHMARK_CELL_MINIMUM);
      return {
        id,
        unit,
        status: enough ? ("descriptive" as const) : ("withheld" as const),
        knownWorkspacesBand: enough ? band(known.length) : null,
        median: enough
          ? rounded(
              known.map((o) => o.outcomes[id]!),
              id,
            )
          : null,
        scoreBands: showCells
          ? cells.map((c) => ({
              scoreBand: c.band.id,
              knownWorkspacesBand: cellBand(c.members.length),
              median: rounded(
                c.members.map((o) => o.outcomes[id]!),
                id,
              ),
            }))
          : [],
      };
    });
    if (!metrics.some((m) => m.status === "descriptive")) continue;
    const first = members[0];
    cohorts.push({
      id: key,
      group: first.group,
      releaseId,
      mappingVersion: PRACTICE_MAPPING_VERSION,
      periodStart: first.periodStart,
      periodEnd: first.periodEnd,
      calendarDays: Number(first.periodEnd.slice(8, 10)),
      provenance: first.provenance!,
      stage: first.stage,
      feeModel: first.feeModel,
      source: first.source,
      currency: first.currency,
      workspacesBand: band(members.length),
      medianReadinessScore:
        Math.round(calibrationMedian(members.map((o) => o.score))! / 5) * 5,
      metrics,
    });
  }
  return cohorts.length
    ? {
        ...base,
        status: "descriptive",
        publicationEnabled: true,
        title: "Practice-specific participant comparisons",
        explanation:
          "Rounded, equally weighted workspace medians within the exact scope shown. Each published metric has at least 30 known distinct workspace values. These describe participants, not the market or your percentile.",
        cohorts,
      }
    : base;
}
