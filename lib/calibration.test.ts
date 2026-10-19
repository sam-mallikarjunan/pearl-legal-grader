import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "./catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "./demo";
import { assessPractice } from "./scoring";
import {
  calibrationDataset,
  calibrationSplit,
  calibrationSummary,
  parseCalibrationWeights,
  projectCalibrationSource,
  spearmanAssociation,
  type CalibrationDataset,
  type CalibrationPair,
  type CalibrationSource,
} from "./calibration";
import { DOMAIN_IDS } from "./types";
import type { SavedAssessment } from "./storage";

const now = new Date("2026-10-19T12:00:00.000Z");
const workspace = "1d913806-2a07-4b54-a907-a8a361939d51";
const baselineId = "e8c70e4c-edb2-4a7e-8687-399a892cfc66";
const periodId = "7434cf25-0528-4943-abd7-a03d6594bf1b";
const key = (n: number) => n.toString(16).padStart(8, "0") + "f".repeat(56);
export function calibrationFixture(): CalibrationSource {
  const assessment = assessPractice({
    context: {
      ...SAMPLE_CONTEXT,
      practiceArea: "Private firm detail",
      jurisdiction: "Private location",
    },
    answers: SAMPLE_ANSWERS,
    controls: SAMPLE_CONTROLS,
    release: DEFAULT_RELEASE,
  });
  return {
    workspaceId: workspace,
    benchmarking: true,
    outcomeResearch: true,
    periods: [
      {
        id: periodId,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        source: "self_reported",
        currency: "USD",
        baselineReportId: baselineId,
        inquiries: 100,
        contacted: 80,
        booked: 50,
        attended: 30,
        clients: 20,
        leadSpendMinor: 450000,
        cohortBilledMinor: 2000000,
        cohortCollectedMinor: 1600000,
        adminHours: 60,
      },
    ],
    baselines: [
      {
        id: baselineId,
        savedAt: "2026-08-31T12:30:00.000Z",
        report: {
          id: "9e9f6fe0-792d-455a-815b-fe203cd865f5",
          practiceId: "3ce71228-2fc0-4f58-8ac5-3938a1981461",
          createdAt: "2026-08-31T12:00:00.000Z",
          label: "Private owner label",
          isSample: false,
          assessment: structuredClone(assessment),
        },
      },
    ],
  };
}
function pairs(n: number): CalibrationPair[] {
  return Array.from({ length: n }, (_, i) => ({
    workspaceKey: key(i),
    releaseId: DEFAULT_RELEASE.id,
    currency: "USD",
    source: "self_reported",
    stage: "established",
    feeModel: "hourly",
    score: i % 3 === 0 ? 40 : i % 3 === 1 ? 70 : 90,
    domains: DOMAIN_IDS.map((id) => ({
      id,
      score: i % 3 === 0 ? 40 : i % 3 === 1 ? 70 : 90,
    })),
    outcomes: {
      inquiry_client_fraction: (i % 10) / 10,
      billed_collection_fraction: 0.8,
      owner_admin_hours_day: 2,
    },
  }));
}
const dataset = (records: CalibrationPair[]): CalibrationDataset => ({
  pairs: records,
  candidateWorkspaces: records.length,
  excluded: {},
  truncated: false,
});
const weights = Object.fromEntries(DOMAIN_IDS.map((id) => [id, 1]));

test("calibration reproduces canonical pre-period baseline and keeps invoice/inquiry cohort metrics separate", () => {
  const result = projectCalibrationSource(
    calibrationFixture(),
    DEFAULT_RELEASE,
    () => key(0),
    now,
  );
  assert.equal(result.eligible, true);
  if (!result.eligible) return;
  assert.deepEqual(result.pair.outcomes, {
    inquiry_client_fraction: 0.2,
    billed_collection_fraction: 0.8,
    owner_admin_hours_day: 2,
  });
  assert.equal(result.pair.stage, SAMPLE_CONTEXT.stage);
  assert.equal(result.pair.feeModel, SAMPLE_CONTEXT.feeModel);
  assert.equal(JSON.stringify(result.pair).includes("Private"), false);
});

test("both permissions are required; backdated assessment cannot conceal a post-period-start upload", () => {
  for (const permission of ["benchmarking", "outcomeResearch"] as const) {
    const c = calibrationFixture();
    c[permission] = false;
    assert.deepEqual(
      projectCalibrationSource(c, DEFAULT_RELEASE, () => key(0), now),
      { eligible: false, reason: "no_consent" },
    );
  }
  const posthoc = calibrationFixture();
  posthoc.baselines[0].savedAt = "2026-09-01T00:00:01.000Z";
  assert.deepEqual(
    projectCalibrationSource(posthoc, DEFAULT_RELEASE, () => key(0), now),
    { eligible: false, reason: "baseline_after_start" },
  );
  const future = calibrationFixture();
  (future.baselines[0].report as SavedAssessment).createdAt =
    "2026-09-02T00:00:00.000Z";
  assert.equal(
    projectCalibrationSource(future, DEFAULT_RELEASE, () => key(0), now)
      .eligible,
    false,
  );
});

test("old baselines, tampered scores, different releases and incomplete evidence cannot enter calibration", () => {
  const stale = calibrationFixture();
  (stale.baselines[0].report as SavedAssessment).createdAt =
    "2026-01-01T00:00:00.000Z";
  assert.deepEqual(
    projectCalibrationSource(stale, DEFAULT_RELEASE, () => key(0), now),
    { eligible: false, reason: "stale_baseline" },
  );
  const forged = calibrationFixture();
  (forged.baselines[0].report as SavedAssessment).assessment.overallScore = 100;
  assert.deepEqual(
    projectCalibrationSource(forged, DEFAULT_RELEASE, () => key(0), now),
    { eligible: false, reason: "invalid_record" },
  );
  const wrong = calibrationFixture();
  (wrong.baselines[0].report as SavedAssessment).assessment.releaseId =
    "unpublished-other";
  assert.deepEqual(
    projectCalibrationSource(wrong, DEFAULT_RELEASE, () => key(0), now),
    { eligible: false, reason: "different_release" },
  );
  const incomplete = calibrationFixture();
  (incomplete.baselines[0].report as SavedAssessment).assessment =
    assessPractice({
      context: SAMPLE_CONTEXT,
      answers: {},
      controls: {},
      release: DEFAULT_RELEASE,
    });
  assert.deepEqual(
    projectCalibrationSource(incomplete, DEFAULT_RELEASE, () => key(0), now),
    { eligible: false, reason: "insufficient_evidence" },
  );
});

test("monthly analysis excludes a valid annual tracking period and rejects overlapping source periods", () => {
  const annual = calibrationFixture();
  Object.assign(annual.periods[0]!, {
    startDate: "2025-10-01",
    endDate: "2026-09-30",
  });
  assert.deepEqual(
    projectCalibrationSource(annual, DEFAULT_RELEASE, () => key(0), now),
    { eligible: false, reason: "incomparable_period" },
  );
  const overlap = calibrationFixture();
  overlap.periods.push({
    ...(overlap.periods[0] as object),
    id: "b2b0483a-b53f-45e9-8f7c-4cd1bbf38c4b",
    startDate: "2026-09-20",
    endDate: "2026-10-17",
  });
  assert.deepEqual(
    projectCalibrationSource(overlap, DEFAULT_RELEASE, () => key(0), now),
    { eligible: false, reason: "invalid_record" },
  );
});

test("earliest eligible pair is retained even when later periods have more favorable or less missing outcomes", () => {
  const c = calibrationFixture();
  (c.baselines[0].report as SavedAssessment).createdAt =
    "2026-07-31T12:00:00.000Z";
  c.baselines[0].savedAt = "2026-07-31T13:00:00.000Z";
  c.periods.unshift({
    ...(c.periods[0] as object),
    id: "b2b0483a-b53f-45e9-8f7c-4cd1bbf38c4b",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    inquiries: null,
    contacted: null,
    booked: null,
    attended: null,
    clients: null,
    cohortBilledMinor: null,
    cohortCollectedMinor: null,
    adminHours: null,
  });
  const result = calibrationDataset([c], DEFAULT_RELEASE, () => key(0), now);
  assert.equal(result.pairs.length, 1);
  assert.deepEqual(Object.values(result.pairs[0].outcomes), [null, null, null]);
  assert.equal(
    calibrationDataset([c, c], DEFAULT_RELEASE, () => key(0), now).truncated,
    true,
  );
});

test("29 workspaces publish no cohort; 30 allow only known metrics and five-member score cells", () => {
  const small = calibrationSummary(dataset(pairs(29)), DEFAULT_RELEASE);
  assert.equal(small.status, "forming");
  assert.equal(small.eligibleWorkspaces, null);
  assert.deepEqual(small.cohorts, []);
  const known = pairs(30);
  known[0].outcomes.inquiry_client_fraction = null;
  const result = calibrationSummary(dataset(known), DEFAULT_RELEASE);
  assert.equal(result.status, "descriptive");
  assert.equal(result.cohorts[0].metrics[0].status, "forming");
  assert.equal(result.cohorts[0].metrics[0].medianOutcome, null);
  assert.equal(result.cohorts[0].metrics[1].medianOutcome, 0.8);
  assert.equal(result.cohorts[0].metrics[1].rankAssociation, null);
  const sparse = pairs(30);
  sparse.forEach((p, i) => {
    p.score = i < 4 ? 40 : i < 17 ? 70 : 90;
  });
  const bands = calibrationSummary(dataset(sparse), DEFAULT_RELEASE).cohorts[0]
    .metrics[0].scoreBands;
  assert.equal(bands[0].workspaces, null);
  assert.equal(bands[0].medianOutcome, null);
  assert.equal(bands[1].workspaces, "10–14");
});

test("release, currency, source, stage and fee-model strata never pool to reach publication thresholds", () => {
  for (const field of ["currency", "source", "stage", "feeModel"] as const) {
    const split = pairs(30);
    if (field === "currency") split[29].currency = "CAD";
    if (field === "source") split[29].source = "export";
    if (field === "stage") split[29].stage = "prelaunch";
    if (field === "feeModel") split[29].feeModel = "flat";
    assert.deepEqual(
      calibrationSummary(dataset(split), DEFAULT_RELEASE).cohorts,
      [],
      field,
    );
  }
  const mixed = pairs(30);
  mixed[0].releaseId = "old-release";
  assert.equal(
    calibrationSummary(dataset(mixed), DEFAULT_RELEASE).status,
    "incomplete",
  );
  const partial = dataset(pairs(100));
  partial.truncated = true;
  const hidden = calibrationSummary(
    partial,
    DEFAULT_RELEASE,
    parseCalibrationWeights(weights)!,
  );
  assert.deepEqual(hidden.cohorts, []);
  assert.equal(hidden.eligibleWorkspaces, null);
});

test("rank association handles ties, reverse order, constants and invalid observations without fabricated zero", () => {
  assert.equal(spearmanAssociation([1, 2, 3], [10, 20, 30]), 1);
  assert.equal(spearmanAssociation([1, 2, 3], [30, 20, 10]), -1);
  assert.equal(spearmanAssociation([1, 1, 2, 3], [2, 2, 4, 1]), -1 / 3);
  assert.equal(spearmanAssociation([1, 1, 1], [1, 2, 3]), null);
  assert.equal(spearmanAssociation([1, 2, 3], [1, 1, 1]), null);
  assert.equal(spearmanAssociation([1, NaN], [1, 2]), null);
});

test("candidate comparison needs 100 independent same-context pairs and 70/30 stable workspace partitions", () => {
  const candidate = parseCalibrationWeights(weights)!;
  assert.equal(
    calibrationSummary(dataset(pairs(99)), DEFAULT_RELEASE, candidate)
      .cohorts[0].metrics[0].candidate.status,
    "forming",
  );
  const result = calibrationSummary(
    dataset(pairs(100)),
    DEFAULT_RELEASE,
    candidate,
  );
  const comparison = result.cohorts[0].metrics[0].candidate;
  assert.equal(comparison.status, "exploratory");
  assert.equal(comparison.train?.workspaces, "70–74");
  assert.equal(comparison.test?.workspaces, "30–34");
  assert.equal(
    comparison.test?.candidateAssociation,
    comparison.test?.currentAssociation,
  );
  assert.equal(calibrationSplit(key(69)), "train");
  assert.equal(calibrationSplit(key(70)), "test");
  const unbalanced = pairs(100).map((p, i) => ({
    ...p,
    workspaceKey: key(i * 100),
  }));
  assert.equal(
    calibrationSummary(dataset(unbalanced), DEFAULT_RELEASE, candidate)
      .cohorts[0].metrics[0].candidate.status,
    "forming",
  );
});

test("aggregate output excludes raw identity and business values and candidate weights never modify the release", () => {
  const immutable = JSON.stringify(DEFAULT_RELEASE),
    input = dataset(pairs(100));
  const summary = calibrationSummary(
    input,
    DEFAULT_RELEASE,
    parseCalibrationWeights({ ...weights, cash: 5 })!,
  );
  const json = JSON.stringify(summary);
  for (const forbidden of [
    "workspaceKey",
    key(0),
    "baselineReportId",
    "inquiries",
    "cohortBilledMinor",
    "Private owner label",
  ])
    assert.equal(json.includes(forbidden), false, forbidden);
  assert.equal(JSON.stringify(DEFAULT_RELEASE), immutable);
  assert.equal(summary.gradeChangesEnabled, false);
  for (const invalid of [
    { ...weights, cash: 0 },
    { ...weights, cash: Infinity },
    { ...weights, cash: 101 },
    { ...weights, extra: 1 },
    { cash: 1 },
  ])
    assert.equal(parseCalibrationWeights(invalid), null);
});

test("genuine preregistered baseline hashes/times/context are required and never pooled with retrospective evidence", () => {
  const fixture = calibrationFixture();
  const p = fixture.periods[0] as Record<string, unknown>;
  const baseline = fixture.baselines[0];
  baseline.contentHash = "a".repeat(64);
  const plan = {
    id: "10000000-0000-4000-8000-000000000001",
    requestId: "10000000-0000-4000-8000-000000000002",
    revision: 1,
    startDate: p.startDate,
    endDate: p.endDate,
    source: p.source,
    currency: p.currency,
    baselineReportId: baselineId,
    baselineReleaseId: DEFAULT_RELEASE.id,
    baselineStage: SAMPLE_CONTEXT.stage,
    baselineFeeModel: SAMPLE_CONTEXT.feeModel,
    status: "reported",
    outcomeId: periodId,
    createdAt: "2026-08-31T13:00:00Z",
    updatedAt: "2026-10-01T01:00:00Z",
    reportedAt: "2026-10-01T01:00:00Z",
    withdrawnAt: null,
    baselineContentHash: "a".repeat(64),
  };
  fixture.plans = [plan];
  const deletedPlan = {
    ...plan,
    status: "withdrawn",
    outcomeId: null,
    withdrawnAt: "2026-10-02T00:00:00Z",
  };
  assert.equal(
    projectCalibrationSource(
      { ...fixture, plans: [deletedPlan] },
      DEFAULT_RELEASE,
      () => key(1),
      now,
    ).eligible,
    false,
  );
  const result = projectCalibrationSource(
    fixture,
    DEFAULT_RELEASE,
    () => key(1),
    now,
  );
  assert.equal(result.eligible, true);
  if (result.eligible) assert.equal(result.pair.provenance, "preregistered");
  for (const change of [
    { createdAt: "2026-09-01T00:00:00Z" },
    { createdAt: "2026-08-31T12:00:00Z" },
    { baselineContentHash: "b".repeat(64) },
    { baselineFeeModel: "flat" },
    { source: "export" },
    { reportedAt: "2026-09-30T12:00:00Z" },
    { status: "withdrawn", withdrawnAt: "2026-10-02T00:00:00Z" },
  ])
    assert.equal(
      projectCalibrationSource(
        { ...fixture, plans: [{ ...plan, ...change }] },
        DEFAULT_RELEASE,
        () => key(1),
        now,
      ).eligible,
      false,
    );
  const mixed = pairs(30).map((p, i) => ({
    ...p,
    provenance:
      i < 15 ? ("preregistered" as const) : ("retrospective" as const),
  }));
  const summary = calibrationSummary(
    { pairs: mixed, candidateWorkspaces: 30, excluded: {}, truncated: false },
    DEFAULT_RELEASE,
  );
  assert.equal(summary.cohorts.length, 0);
  assert.equal(summary.evidenceTracks.length, 2);
  assert(summary.evidenceTracks.every((t) => t.status === "forming"));
});
test("prospective-first one-workspace selection is deterministic and does not replace missing values", () => {
  const fixture = calibrationFixture();
  const old = fixture.periods[0] as Record<string, unknown>;
  const newId = "10000000-0000-4000-8000-000000000003";
  fixture.periods = [
    old,
    {
      ...old,
      id: newId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      inquiries: null,
      clients: null,
    },
  ];
  fixture.baselines[0].contentHash = "a".repeat(64);
  fixture.plans = [
    {
      id: "10000000-0000-4000-8000-000000000004",
      requestId: "10000000-0000-4000-8000-000000000005",
      revision: 1,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      source: "self_reported",
      currency: "USD",
      baselineReportId: baselineId,
      baselineReleaseId: DEFAULT_RELEASE.id,
      baselineStage: SAMPLE_CONTEXT.stage,
      baselineFeeModel: SAMPLE_CONTEXT.feeModel,
      status: "reported",
      outcomeId: newId,
      createdAt: "2026-09-30T13:00:00Z",
      updatedAt: "2026-11-01T01:00:00Z",
      reportedAt: "2026-11-01T01:00:00Z",
      withdrawnAt: null,
      baselineContentHash: "a".repeat(64),
    },
  ];
  const result = projectCalibrationSource(
    fixture,
    DEFAULT_RELEASE,
    () => key(1),
    new Date("2026-11-02T00:00:00Z"),
  );
  assert(result.eligible);
  if (result.eligible) {
    assert.equal(result.pair.provenance, "preregistered");
    assert.equal(result.pair.outcomes.inquiry_client_fraction, null);
  }
});
