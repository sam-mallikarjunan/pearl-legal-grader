import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "./catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "./demo";
import { assessPractice } from "./scoring";
import type { CloudReport } from "./account/types";
import type { OutcomePeriod } from "./outcomes";
import {
  buildProgressInsights,
  buildReassessmentInsights,
  compareOutcomePeriods,
  compareReassessments,
  getLatestComparableChange,
  progressObservations,
} from "./progress-insights";
const now = new Date("2026-10-19T12:00:00Z");
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function period(
  n: number,
  changes: Partial<OutcomePeriod> = {},
): OutcomePeriod {
  return {
    id: uuid(n),
    revision: 0,
    startDate: n === 1 ? "2026-08-01" : "2026-09-01",
    endDate: n === 1 ? "2026-08-31" : "2026-09-30",
    source: "self_reported",
    currency: "USD",
    baselineReportId: null,
    inquiries: 100,
    contacted: 80,
    booked: 40,
    attended: 30,
    clients: 20,
    leadSpendMinor: 20000,
    cohortBilledMinor: 50000,
    cohortCollectedMinor: 40000,
    adminHours: 30,
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z",
    ...changes,
  };
}
function report(
  n: number,
  changes: {
    practiceId?: string;
    context?: Partial<typeof SAMPLE_CONTEXT>;
    answers?: Record<string, any>;
    release?: typeof DEFAULT_RELEASE;
    createdAt?: string;
  } = {},
): CloudReport {
  const release = changes.release ?? DEFAULT_RELEASE;
  return {
    id: uuid(100 + n),
    canonical: true,
    savedAt: `2026-10-${String(n + 1).padStart(2, "0")}T12:01:00Z`,
    actionProgress: [],
    snapshot: {
      id: uuid(200 + n),
      practiceId: changes.practiceId ?? uuid(999),
      label: `Owner report ${n}`,
      createdAt:
        changes.createdAt ??
        `2026-10-${String(n + 1).padStart(2, "0")}T12:00:00Z`,
      isSample: false,
      assessment: assessPractice({
        context: { ...SAMPLE_CONTEXT, ...changes.context },
        answers: { ...SAMPLE_ANSWERS, ...changes.answers },
        controls: SAMPLE_CONTROLS,
        release,
      }),
    },
  };
}
test("rates retain raw numerators and denominators; changes use percentage points, not percentage growth", () => {
  const result = buildProgressInsights(
    [period(1), period(2, { clients: 30, cohortCollectedMinor: 45000 })],
    undefined,
    undefined,
    [],
    now,
  );
  assert.equal(result.status, "comparison");
  const conversion = result.metrics.find((m) => m.id === "inquiry_conversion")!;
  assert.equal(conversion.current.value, 30);
  assert.equal(conversion.previous!.value, 20);
  assert.equal(conversion.delta, 10);
  assert.equal(conversion.unit, "percentage_points");
  assert.equal(conversion.current.numerator, 30);
  assert.equal(conversion.current.denominator, 100);
  assert.equal(
    result.metrics.find((m) => m.id === "invoice_collection")!.delta,
    10,
  );
});
test("acquisition cost uses matched lead spend/clients, invoice collection stays separate, hours use calendar days", () => {
  const a = period(1, { leadSpendMinor: 40000, clients: 20, adminHours: 31 });
  const b = period(2, { leadSpendMinor: 45000, clients: 30, adminHours: 15 });
  const normalized = getLatestComparableChange([a, b], [], now)!;
  const spend = normalized.metrics.find((m) => m.id === "cost_per_client")!;
  assert.equal(spend.current, 1500);
  assert.equal(spend.previous, 2000);
  assert.equal(spend.delta, -500);
  assert.equal(spend.currentNumerator, 45000);
  assert.equal(spend.currentDenominator, 30);
  assert.equal(spend.unit, "minor_currency_per_client");
  const hours = normalized.metrics.find(
    (m) => m.id === "owner_admin_hours_day",
  )!;
  assert.equal(hours.current, 0.5);
  assert.equal(hours.previous, 1);
  assert.equal(hours.delta, -0.5);
  assert.equal(hours.currentDenominator, 30);
  assert.equal("collectedPerClient" in normalized, false);
});
test("unknown values and zero denominators abstain; known zero numerator is a real zero", () => {
  const p = period(2, {
    clients: 0,
    inquiries: 0,
    contacted: null,
    booked: null,
    attended: null,
    leadSpendMinor: 0,
    cohortBilledMinor: 0,
    cohortCollectedMinor: 0,
    adminHours: null,
  });
  const m = progressObservations(p);
  assert.equal(m.inquiry_conversion.value, null);
  assert.match(m.inquiry_conversion.reason!, /undefined, not zero/);
  assert.equal(m.cost_per_client.value, null);
  assert.equal(m.invoice_collection.value, null);
  assert.equal(m.owner_admin_hours_day.value, null);
  const zero = progressObservations(
    period(2, {
      clients: 0,
      leadSpendMinor: 0,
      cohortCollectedMinor: 0,
      adminHours: 0,
    }),
  );
  assert.equal(zero.inquiry_conversion.value, 0);
  assert.equal(zero.invoice_collection.value, 0);
  assert.equal(zero.owner_admin_hours_day.value, 0);
  const latest = getLatestComparableChange(
    [period(1), period(2, { clients: null })],
    [],
    now,
  )!;
  assert.equal(
    latest.metrics.find((m) => m.id === "inquiry_conversion")!.delta,
    null,
  );
});
test("source, currency, overlapping windows and calendar-vs-rolling scope never mix", () => {
  const a = period(1),
    b = period(2);
  for (const change of [
    { currency: "EUR" as const },
    { source: "export" as const },
    { startDate: "2026-08-15", endDate: "2026-09-15" },
    { startDate: "2026-09-02", endDate: "2026-10-01" },
  ])
    assert.equal(
      compareOutcomePeriods({ ...b, ...change }, a).comparable,
      false,
    );
  assert.equal(
    buildProgressInsights(
      [a, { ...b, currency: "EUR" }],
      undefined,
      undefined,
      [],
      now,
    ).status,
    "noncomparable",
  );
  const overlap = buildProgressInsights(
    [a, { ...b, startDate: "2026-08-31" }],
    undefined,
    undefined,
    [],
    now,
  );
  assert.equal(overlap.status, "invalid");
  assert.equal(overlap.metrics.length, 0);
});
test("full calendar months can vary28–31days; other windows require equal duration and gaps are explicit", () => {
  const feb = period(1, { startDate: "2026-02-01", endDate: "2026-02-28" }),
    march = period(2, { startDate: "2026-03-01", endDate: "2026-03-31" });
  assert.equal(compareOutcomePeriods(march, feb).comparable, true);
  const a = period(1, { startDate: "2026-07-02", endDate: "2026-07-31" }),
    b = period(2, { startDate: "2026-09-02", endDate: "2026-10-01" });
  assert.equal(compareOutcomePeriods(b, a).comparable, true);
  assert.equal(
    compareOutcomePeriods({ ...b, endDate: "2026-09-30" }, a).comparable,
    false,
  );
  const jan = period(1, { startDate: "2026-01-01", endDate: "2026-01-31" });
  assert.equal(compareOutcomePeriods(march, jan).gapDays, 28);
});
test("baseline scope guards separate practices and changed business context, while unlinked tracking remains explicit", () => {
  const a = report(1),
    b = report(2),
    p = period(1, { baselineReportId: a.id }),
    q = period(2, { baselineReportId: b.id });
  assert.equal(compareOutcomePeriods(q, p).comparable, false);
  assert.equal(compareOutcomePeriods(q, p, [a, b]).comparable, true);
  assert.equal(
    compareOutcomePeriods(q, p, [a, report(2, { practiceId: uuid(998) })])
      .comparable,
    false,
  );
  assert.equal(
    compareOutcomePeriods(q, p, [
      a,
      report(2, { context: { feeModel: "flat" } }),
    ]).comparable,
    false,
  );
  assert.equal(
    compareOutcomePeriods(q, { ...p, baselineReportId: null }, [a, b])
      .comparable,
    false,
  );
  assert.match(
    compareOutcomePeriods(period(2), period(1)).scopeNote,
    /unlinked owner-declared/,
  );
});
test("automatic comparison takes latest period and nearest compatible earlier one, never a favorable outcome", () => {
  const early = period(1, {
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    clients: 30,
  });
  const nearest = period(2, {
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    clients: 5,
  });
  const latest = period(3, { clients: null });
  const other = period(4, {
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    source: "export",
  });
  const result = buildProgressInsights(
    [early, nearest, latest, other],
    undefined,
    undefined,
    [],
    now,
  );
  assert.equal(result.current!.id, latest.id);
  assert.equal(result.previous!.id, nearest.id);
  assert.equal(result.metrics[0].delta, null);
  assert.equal(result.history.length, 3);
  assert.equal(result.comparison!.gapDays, 0);
  const normalized = getLatestComparableChange(
    [early, nearest, latest, other],
    [],
    now,
  )!;
  assert.equal(normalized.previousId, nearest.id);
  assert.equal(normalized.metrics[0].current, null);
});
test("empty, single, malformed, duplicate and oversize extracts provide measurement guidance without invented history", () => {
  const empty = buildProgressInsights([], undefined, undefined, [], now);
  assert.equal(empty.status, "empty");
  assert.match(empty.nextMeasurement, /closed business period/);
  const single = buildProgressInsights(
    [period(1)],
    undefined,
    undefined,
    [],
    now,
  );
  assert.equal(single.status, "single");
  assert.match(single.nextMeasurement, /same practice, source and currency/);
  assert.equal(single.metrics[0].delta, null);
  for (const rows of [
    [period(1), period(1)],
    Array(25).fill(period(1)),
    [period(2, { inquiries: NaN })],
    [period(2, { updatedAt: "invalid" })],
    [period(2, { adminHours: 721 })],
  ]) {
    const invalid = buildProgressInsights(rows, undefined, undefined, [], now);
    assert.equal(invalid.status, "invalid");
    assert.equal(invalid.metrics.length, 0);
    assert.equal(getLatestComparableChange(rows, [], now), null);
  }
});
test("owner corrections update observations and metadata while leaving original input and issued reports untouched", () => {
  const periods = [period(1), period(2)],
    before = JSON.stringify(periods);
  const reports = [report(1), report(2)],
    reportsBefore = JSON.stringify(reports);
  buildProgressInsights(periods, undefined, undefined, reports, now);
  assert.equal(JSON.stringify(periods), before);
  assert.equal(JSON.stringify(reports), reportsBefore);
  const edited = buildProgressInsights(
    [
      periods[0],
      {
        ...periods[1],
        clients: 25,
        revision: 1,
        updatedAt: "2026-10-02T12:00:00Z",
      },
    ],
    undefined,
    undefined,
    reports,
    now,
  );
  assert.equal(edited.current!.revision, 1);
  assert.equal(edited.metrics[0].delta, 5);
  assert.match(edited.current!.updatedAt, /2026-10-02/);
});
test("reassessment points compare only same canonical practice/context/rubric/coverage and applicable questions", () => {
  const a = report(1),
    b = report(2, { answers: { "presence-1": "reviewed" } });
  const result = compareReassessments(b, a);
  assert.equal(result.comparable, true);
  assert.equal(typeof result.delta, "number");
  assert.equal(result.domains.length, 6);
  const unchanged = compareReassessments(report(2), a);
  assert.equal(unchanged.delta, 0);
  for (const changed of [
    report(2, { practiceId: uuid(998) }),
    report(2, { context: { stage: "new" } }),
    report(2, { release: { ...DEFAULT_RELEASE, id: "new-rubric" } }),
    report(2, { answers: { "presence-2": "unknown" } }),
  ]) {
    const comparison = compareReassessments(changed, a);
    assert.equal(comparison.comparable, false);
    assert.equal(comparison.delta, null);
    assert(comparison.reasons.length > 0);
  }
});
test("coverage and explicit applicability changes are disclosed instead of calling changed denominators progress", () => {
  const a = report(1),
    notApplicable = report(2, { context: { websiteStatus: "no_site" } });
  const result = compareReassessments(notApplicable, a);
  assert.equal(result.comparable, false);
  assert.equal(result.delta, null);
  assert.equal(result.applicabilityChanged, true);
  const incomplete = compareReassessments(
    report(2, { answers: { "presence-2": "unknown" } }),
    a,
  );
  assert.equal(incomplete.coverageChanged, true);
  assert(incomplete.reasons.some((r) => /evidence coverage/.test(r)));
  const forged = structuredClone(report(2));
  forged.snapshot.assessment.overallScore = 99;
  assert.equal(compareReassessments(forged, a).comparable, false);
  const sample = report(2);
  sample.snapshot.isSample = true;
  assert.equal(compareReassessments(sample, a).comparable, false);
});
test("reassessment default uses nearest older report for the same practice and preserves different rubric explanations", () => {
  const a = report(1),
    other = report(2, { practiceId: uuid(998) }),
    current = report(3);
  const result = buildReassessmentInsights([other, current, a]);
  assert.equal(result.current!.id, current.id);
  assert.equal(result.previous!.id, a.id);
  assert.equal(result.comparison!.comparable, true);
  const explicit = buildReassessmentInsights(
    [other, current, a],
    current.id,
    other.id,
  );
  assert.equal(explicit.comparison!.delta, null);
  assert(
    explicit.comparison!.reasons.some((r) =>
      /different saved practices/.test(r),
    ),
  );
});
