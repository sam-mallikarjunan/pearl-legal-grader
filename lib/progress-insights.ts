import type { CloudReport } from "./account/types";
import {
  accountRecord,
  accountUuid,
  canonicalJson,
  parseAccountReport,
} from "./account/validation";
import {
  outcomePeriodDays,
  parseOutcomePeriodInput,
  type OutcomePeriod,
} from "./outcomes";

export const PROGRESS_METRIC_IDS = [
  "inquiry_conversion",
  "invoice_collection",
  "cost_per_client",
  "owner_admin_hours_day",
] as const;
export type ProgressMetricId = (typeof PROGRESS_METRIC_IDS)[number];
export type ProgressDeltaUnit =
  | "percentage_points"
  | "minor_currency_per_client"
  | "hours_per_calendar_day";
export interface ProgressObservation {
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  reason: string | null;
}
export interface ProgressMetricChange {
  id: ProgressMetricId;
  label: string;
  current: ProgressObservation;
  previous: ProgressObservation | null;
  delta: number | null;
  unit: ProgressDeltaUnit;
  description: string;
}
export interface LatestComparableChange {
  currentId: string;
  previousId: string;
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
  gapDays: number;
  source: OutcomePeriod["source"];
  currency: OutcomePeriod["currency"];
  metrics: Array<{
    id: ProgressMetricId;
    current: number | null;
    previous: number | null;
    delta: number | null;
    unit: ProgressDeltaUnit;
    reason: string | null;
    currentNumerator: number | null;
    currentDenominator: number | null;
    previousNumerator: number | null;
    previousDenominator: number | null;
  }>;
}
const DAY = 86400000;
const NUMBERS = [
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
const METADATA = [
  "startDate",
  "endDate",
  "source",
  "currency",
  "baselineReportId",
] as const;
const stamp = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const startStamp = (d: string) => Date.parse(`${d}T00:00:00Z`);
const rounded = (n: number) => Math.round(n * 1000000) / 1000000;
export const progressPeriodLabel = (
  p: Pick<OutcomePeriod, "startDate" | "endDate">,
) => `${p.startDate} to ${p.endDate}`;
export function progressWindowKind(
  p: Pick<OutcomePeriod, "startDate" | "endDate">,
): "calendar_month" | "fixed_duration" {
  const start = new Date(`${p.startDate}T00:00:00Z`),
    end = new Date(`${p.endDate}T00:00:00Z`);
  return start.getUTCDate() === 1 &&
    end.getUTCDate() ===
      new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
      ).getUTCDate() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCFullYear() === end.getUTCFullYear()
    ? "calendar_month"
    : "fixed_duration";
}
/** Re-validate aggregate inputs; a broken/private extract never turns into fabricated progress. */
function readPeriods(
  values: OutcomePeriod[],
  now: Date,
): OutcomePeriod[] | null {
  if (!Array.isArray(values) || values.length > 24) return null;
  try {
    const periods = values
      .map((value) => {
        if (
          !accountRecord(value) ||
          !accountUuid(value.id) ||
          !Number.isSafeInteger(value.revision) ||
          value.revision < 0 ||
          value.revision > 1_000_000 ||
          !stamp(value.createdAt) ||
          !stamp(value.updatedAt) ||
          Date.parse(value.updatedAt) < Date.parse(value.createdAt)
        )
          throw new Error("invalid");
        const input = parseOutcomePeriodInput(
          Object.fromEntries(
            [...METADATA, ...NUMBERS].map((key) => [key, value[key]]),
          ),
          now,
        );
        return {
          ...input,
          id: value.id,
          revision: value.revision,
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
        };
      })
      .sort(
        (a, b) =>
          b.endDate.localeCompare(a.endDate) ||
          b.startDate.localeCompare(a.startDate) ||
          a.id.localeCompare(b.id),
      );
    if (
      new Set(periods.map((p) => p.id)).size !== periods.length ||
      periods.some((p, i) => i > 0 && p.endDate >= periods[i - 1].startDate)
    )
      return null;
    return periods;
  } catch {
    return null;
  }
}
function baselineScope(report: CloudReport) {
  const c = report.snapshot.assessment.contextSnapshot;
  return canonicalJson({
    practice: report.snapshot.practiceId,
    stage: c.stage,
    feeModel: c.feeModel,
    practiceArea: c.practiceArea,
    jurisdiction: c.jurisdiction,
  });
}
export function compareOutcomePeriods(
  current: OutcomePeriod,
  previous: OutcomePeriod,
  reports: CloudReport[] = [],
) {
  const reasons: string[] = [];
  const days = outcomePeriodDays(current.startDate, current.endDate),
    priorDays = outcomePeriodDays(previous.startDate, previous.endDate);
  if (current.id === previous.id)
    reasons.push("Choose two different saved periods.");
  if (previous.endDate >= current.startDate)
    reasons.push(
      "The previous period must end before the current period begins; overlapping or reversed windows cannot be compared.",
    );
  if (current.source !== previous.source)
    reasons.push(
      "The figures come from different sources. Use the same source for both periods.",
    );
  if (current.currency !== previous.currency)
    reasons.push(
      "The currencies differ. No exchange-rate conversion or cross-currency comparison is made.",
    );
  if (!Number.isFinite(days) || !Number.isFinite(priorDays))
    reasons.push("One period has invalid dates.");
  else if (progressWindowKind(current) !== progressWindowKind(previous))
    reasons.push(
      "One window is a full calendar month and the other is a rolling or partial-month window. Compare the same window definition.",
    );
  else if (progressWindowKind(current) === "calendar_month") {
    if (days < 28 || days > 31 || priorDays < 28 || priorDays > 31)
      reasons.push(
        "Monthly comparisons need complete 28–31-day calendar months.",
      );
  } else if (days !== priorDays)
    reasons.push(
      "Non-monthly windows need exactly the same number of calendar days.",
    );
  if (current.baselineReportId !== previous.baselineReportId) {
    if (!current.baselineReportId || !previous.baselineReportId)
      reasons.push(
        "One period is linked to a baseline and the other is unlinked. Link both to the same practice scope before comparing them.",
      );
    else {
      const a = reports.find((r) => r.id === current.baselineReportId),
        b = reports.find((r) => r.id === previous.baselineReportId);
      if (
        !a ||
        !b ||
        a.canonical !== true ||
        b.canonical !== true ||
        a.snapshot.isSample ||
        b.snapshot.isSample
      )
        reasons.push(
          "Different baseline links cannot be resolved to the same saved practice scope.",
        );
      else if (baselineScope(a) !== baselineScope(b))
        reasons.push(
          "The linked baseline practice, stage, fee model or service scope changed. These periods are not treated as a like-for-like comparison.",
        );
    }
  }
  return {
    comparable: reasons.length === 0,
    reasons,
    currentDays: days,
    previousDays: priorDays,
    gapDays: Math.max(
      0,
      (startStamp(current.startDate) - startStamp(previous.endDate)) / DAY - 1,
    ),
    scopeNote:
      current.baselineReportId === null && previous.baselineReportId === null
        ? "Both periods are unlinked owner-declared records. This view cannot verify that they describe the same practice or definitions."
        : "Baseline links identify the same declared practice scope; the underlying business figures remain owner reports.",
  };
}
function observation(
  numerator: number | null,
  denominator: number | null,
  scale: number,
  denominatorName: string,
): ProgressObservation {
  if (numerator === null || denominator === null)
    return {
      value: null,
      numerator,
      denominator,
      reason:
        "A required measure is unknown. Leave it blank until you know it.",
    };
  if (denominator === 0)
    return {
      value: null,
      numerator,
      denominator,
      reason: `There are zero ${denominatorName}; the rate is undefined, not zero.`,
    };
  const value = (numerator / denominator) * scale;
  return Number.isFinite(value)
    ? { value: rounded(value), numerator, denominator, reason: null }
    : {
        value: null,
        numerator,
        denominator,
        reason: "This measure cannot be calculated from the saved values.",
      };
}
export function progressObservations(
  period: OutcomePeriod,
): Record<ProgressMetricId, ProgressObservation> {
  return {
    inquiry_conversion: observation(
      period.clients,
      period.inquiries,
      100,
      "inquiries",
    ),
    invoice_collection: observation(
      period.cohortCollectedMinor,
      period.cohortBilledMinor,
      100,
      "billed money units",
    ),
    cost_per_client: observation(
      period.leadSpendMinor,
      period.clients,
      1,
      "retained clients",
    ),
    owner_admin_hours_day: observation(
      period.adminHours,
      outcomePeriodDays(period.startDate, period.endDate),
      1,
      "calendar days",
    ),
  };
}
const definitions: Record<
  ProgressMetricId,
  { label: string; unit: ProgressDeltaUnit; definition: string }
> = {
  inquiry_conversion: {
    label: "Inquiry → retained client",
    unit: "percentage_points",
    definition:
      "Clients retained from inquiries first received in this period, followed through its end.",
  },
  invoice_collection: {
    label: "Issued invoices → collected",
    unit: "percentage_points",
    definition:
      "Collections on invoices issued in this period, measured by that period’s end. This is a separate invoice cohort from the inquiry funnel.",
  },
  cost_per_client: {
    label: "Acquisition spend per retained client",
    unit: "minor_currency_per_client",
    definition:
      "Spend matched to this period’s inquiry cohort, divided by retained clients from that same cohort.",
  },
  owner_admin_hours_day: {
    label: "Your administration hours per day",
    unit: "hours_per_calendar_day",
    definition:
      "Your own administration hours divided by calendar days; team hours are excluded.",
  },
};
function metricChanges(
  current: OutcomePeriod,
  previous: OutcomePeriod | null,
  compatible: boolean,
): ProgressMetricChange[] {
  const a = progressObservations(current),
    b = previous ? progressObservations(previous) : null;
  return PROGRESS_METRIC_IDS.map((id) => {
    const delta =
      compatible && b && a[id].value !== null && b[id].value !== null
        ? rounded(a[id].value! - b[id].value!)
        : null;
    return {
      id,
      label: definitions[id].label,
      current: a[id],
      previous: b?.[id] ?? null,
      delta,
      unit: definitions[id].unit,
      description:
        delta === null
          ? "No comparable change calculated."
          : delta === 0
            ? "The recorded value is unchanged at the displayed precision."
            : `The recorded value is ${delta > 0 ? "higher" : "lower"}. This describes these observations, not an effect of an action or a statistically established trend.`,
    };
  });
}
export function buildProgressInsights(
  periods: OutcomePeriod[],
  currentId?: string,
  previousId?: string,
  reports: CloudReport[] = [],
  now = new Date(),
) {
  const safe = readPeriods(periods, now);
  const initial = {
    periods: safe ?? [],
    current: null as OutcomePeriod | null,
    previous: null as OutcomePeriod | null,
    comparison: null as ReturnType<typeof compareOutcomePeriods> | null,
    metrics: [] as ProgressMetricChange[],
    history: [] as OutcomePeriod[],
    nextMeasurement:
      "Save one closed business period with the measures you know. Unknown values can stay blank.",
  };
  if (!safe)
    return {
      ...initial,
      status: "invalid" as const,
      reasons: [
        "The saved periods are incomplete or inconsistent. Refresh your account before using a comparison.",
      ],
    };
  if (!safe.length)
    return { ...initial, status: "empty" as const, reasons: [] };
  const current = currentId ? safe.find((p) => p.id === currentId) : safe[0];
  if (!current)
    return {
      ...initial,
      status: "invalid" as const,
      reasons: [
        "The selected current period is unavailable. Refresh and select a saved period.",
      ],
    };
  const earlier = safe.filter((p) => p.endDate < current.startDate);
  const previous = previousId
    ? safe.find((p) => p.id === previousId)
    : (earlier.find(
        (p) => compareOutcomePeriods(current, p, reports).comparable,
      ) ?? earlier[0]);
  const history = safe
    .filter(
      (p) =>
        p.id === current.id ||
        (p.endDate < current.startDate &&
          compareOutcomePeriods(current, p, reports).comparable),
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (previousId && !previous)
    return {
      ...initial,
      current,
      history,
      status: "invalid" as const,
      reasons: [
        "The selected previous period is unavailable. Choose a saved earlier period.",
      ],
    };
  if (!previous)
    return {
      ...initial,
      current,
      history,
      metrics: metricChanges(current, null, false),
      status: "single" as const,
      reasons: [],
      nextMeasurement: `Record another closed ${progressWindowKind(current) === "calendar_month" ? "calendar month" : `${outcomePeriodDays(current.startDate, current.endDate)}-day period`} for the same practice, source and currency. Keep the inquiry and invoice cohort definitions consistent.`,
    };
  const comparison = compareOutcomePeriods(current, previous, reports);
  return {
    ...initial,
    current,
    previous,
    comparison,
    history,
    metrics: metricChanges(current, previous, comparison.comparable),
    status: comparison.comparable
      ? ("comparison" as const)
      : ("noncomparable" as const),
    reasons: comparison.reasons,
    nextMeasurement: comparison.comparable
      ? "Keep these definitions for the next period. Correct numbers when needed, and review the underlying records before attributing a change to an action."
      : "Choose matching source, currency, practice scope and window definitions, or collect a new period with those same definitions.",
  };
}
/** Latest period and closest earlier compatible period, never a favorable-outcome search. */
export function getLatestComparableChange(
  periods: OutcomePeriod[],
  reports: CloudReport[] = [],
  now = new Date(),
): LatestComparableChange | null {
  const result = buildProgressInsights(
    periods,
    undefined,
    undefined,
    reports,
    now,
  );
  if (
    result.status !== "comparison" ||
    !result.current ||
    !result.previous ||
    !result.comparison
  )
    return null;
  return {
    currentId: result.current.id,
    previousId: result.previous.id,
    currentStart: result.current.startDate,
    currentEnd: result.current.endDate,
    previousStart: result.previous.startDate,
    previousEnd: result.previous.endDate,
    gapDays: result.comparison.gapDays,
    source: result.current.source,
    currency: result.current.currency,
    metrics: result.metrics.map((m) => ({
      id: m.id,
      current: m.current.value,
      previous: m.previous?.value ?? null,
      delta: m.delta,
      unit: m.unit,
      reason: m.current.reason ?? m.previous?.reason ?? null,
      currentNumerator: m.current.numerator,
      currentDenominator: m.current.denominator,
      previousNumerator: m.previous?.numerator ?? null,
      previousDenominator: m.previous?.denominator ?? null,
    })),
  };
}
export const progressMetricDefinition = (id: ProgressMetricId) =>
  definitions[id].definition;

function canonicalReport(value: CloudReport) {
  try {
    if (
      value.canonical !== true ||
      value.snapshot.isSample ||
      !stamp(value.savedAt)
    )
      return null;
    return parseAccountReport(
      { report: value.snapshot },
      value.snapshot.assessment.releaseSnapshot,
    ).report;
  } catch {
    return null;
  }
}
export function compareReassessments(
  current: CloudReport,
  previous: CloudReport,
) {
  const reasons: string[] = [];
  const a = canonicalReport(current),
    b = canonicalReport(previous);
  if (!a || !b)
    return {
      comparable: false,
      reasons: [
        "Both assessments must be real canonical reports saved in your account.",
      ],
      current,
      previous,
      delta: null as number | null,
      domains: [] as Array<{
        id: string;
        label: string;
        current: number | null;
        previous: number | null;
        delta: number | null;
      }>,
      applicabilityChanged: false,
      coverageChanged: false,
    };
  if (current.id === previous.id || a.id === b.id)
    reasons.push("Choose two different assessments.");
  if (a.practiceId !== b.practiceId)
    reasons.push("These reports describe different saved practices.");
  if (Date.parse(a.createdAt) <= Date.parse(b.createdAt))
    reasons.push(
      "The previous assessment must have been assessed before the current one.",
    );
  if (
    a.assessment.releaseId !== b.assessment.releaseId ||
    canonicalJson(a.assessment.releaseSnapshot) !==
      canonicalJson(b.assessment.releaseSnapshot)
  )
    reasons.push(
      "The rubric version changed. Read both reports in their original versions; a point difference is not reported as progress.",
    );
  if (
    canonicalJson(a.assessment.contextSnapshot) !==
    canonicalJson(b.assessment.contextSnapshot)
  )
    reasons.push(
      "The declared practice context changed. Different scope or applicability can change a score without better operating practices.",
    );
  const findings = (r: typeof a) =>
    r.assessment.domains
      .flatMap((d) => d.findings)
      .sort((x, y) => x.questionId.localeCompare(y.questionId));
  const af = findings(a),
    bf = findings(b);
  const applicabilityChanged =
    canonicalJson(af.map((f) => [f.questionId, f.applicable])) !==
    canonicalJson(bf.map((f) => [f.questionId, f.applicable]));
  const coverageChanged =
    canonicalJson(
      af
        .filter((f) => f.applicable && f.points !== null)
        .map((f) => f.questionId),
    ) !==
      canonicalJson(
        bf
          .filter((f) => f.applicable && f.points !== null)
          .map((f) => f.questionId),
      ) || Math.abs(a.assessment.coverage - b.assessment.coverage) > 0.000001;
  if (applicabilityChanged)
    reasons.push(
      "The applicable questions changed. A different denominator prevents a like-for-like score comparison.",
    );
  if (coverageChanged)
    reasons.push(
      "The set of answered questions or evidence coverage changed. More complete evidence alone is not treated as operating improvement.",
    );
  if (
    a.assessment.overallScore === null ||
    b.assessment.overallScore === null ||
    a.assessment.domains.some((d) => d.status === "incomplete") ||
    b.assessment.domains.some((d) => d.status === "incomplete")
  )
    reasons.push(
      "One assessment lacks enough evidence for a complete readiness score.",
    );
  const comparable = reasons.length === 0;
  return {
    comparable,
    reasons,
    current,
    previous,
    delta: comparable
      ? rounded(a.assessment.overallScore! - b.assessment.overallScore!)
      : null,
    domains: a.assessment.domains.map((d) => {
      const prior = b.assessment.domains.find((p) => p.id === d.id);
      return {
        id: d.id,
        label: d.title,
        current: d.score,
        previous: prior?.score ?? null,
        delta:
          comparable &&
          d.score !== null &&
          prior?.score !== null &&
          prior?.score !== undefined
            ? rounded(d.score - prior.score)
            : null,
      };
    }),
    applicabilityChanged,
    coverageChanged,
  };
}
export function buildReassessmentInsights(
  reports: CloudReport[],
  currentId?: string,
  previousId?: string,
) {
  const ordered = Array.isArray(reports)
    ? reports
        .filter((r) => canonicalReport(r) !== null)
        .sort(
          (a, b) =>
            Date.parse(b.snapshot.createdAt) -
              Date.parse(a.snapshot.createdAt) || a.id.localeCompare(b.id),
        )
        .slice(0, 40)
    : [];
  const current = currentId
    ? ordered.find((r) => r.id === currentId)
    : ordered[0];
  const previous = previousId
    ? ordered.find((r) => r.id === previousId)
    : ordered.find(
        (r) =>
          r.id !== current?.id &&
          r.snapshot.practiceId === current?.snapshot.practiceId &&
          Date.parse(r.snapshot.createdAt) <
            Date.parse(current.snapshot.createdAt),
      );
  return {
    reports: ordered,
    current: current ?? null,
    previous: previous ?? null,
    comparison:
      current && previous ? compareReassessments(current, previous) : null,
  };
}
