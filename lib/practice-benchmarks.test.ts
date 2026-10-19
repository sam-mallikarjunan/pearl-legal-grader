import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "./catalog";
import { SAMPLE_CONTEXT } from "./demo";
import type { SavedAssessment } from "./storage";
import {
  PRACTICE_BENCHMARK_GROUPS,
  PRACTICE_MAPPING_VERSION,
  practiceBenchmarkGroup,
} from "./practice-benchmark-types";
import {
  practiceBenchmarkDataset,
  practiceBenchmarkSummary,
  projectPracticeBenchmarkSource,
} from "./practice-benchmarks";
import {
  PRACTICE_FIXTURE_NOW as now,
  practiceFixtureKey as key,
  practiceFixtureUuid as uuid,
  practiceSourceFixture as source,
  practiceObservationFixtures as observations,
} from "./test-fixtures/practice-benchmarks";
const summarize = (rows = observations(30), incomplete = false) =>
  practiceBenchmarkSummary(
    { observations: rows, incomplete },
    DEFAULT_RELEASE.id,
    now,
  );
const project = (c = source()) =>
  projectPracticeBenchmarkSource(c, DEFAULT_RELEASE, key, now);
test("only nine exact standardized primary areas classify; unknown/custom wording never echoes or infers", () => {
  assert.equal(PRACTICE_BENCHMARK_GROUPS.length, 9);
  for (const g of PRACTICE_BENCHMARK_GROUPS)
    assert.equal(practiceBenchmarkGroup(g.label), g.id);
  for (const input of [
    null,
    "",
    "Other",
    "family law",
    "Family law ",
    "Divorce",
    "Private named area",
    {},
    "General practice / family",
  ])
    assert.equal(practiceBenchmarkGroup(input), null);
});
test("canonical pre-period source projects exact calendar month, group and operational cohort", () => {
  const p = project();
  assert.ok(p);
  assert.equal(p.group, "family");
  assert.equal(p.mappingVersion, PRACTICE_MAPPING_VERSION);
  assert.equal(p.stage, SAMPLE_CONTEXT.stage);
  assert.equal(p.periodStart, "2026-09-01");
  assert.deepEqual(p.outcomes, {
    inquiry_client_fraction: 0.2,
    billed_collection_fraction: 0.8,
    owner_admin_hours_day: 2,
  });
  const json = JSON.stringify(p);
  for (const s of [
    "PRIVATE",
    uuid(1),
    uuid(2001),
    "practiceArea",
    "jurisdiction",
  ])
    assert.equal(json.includes(s), false, s);
  const forged = source();
  (forged.baselines[0].report as SavedAssessment).assessment.overallScore = 100;
  assert.equal(project(forged), null);
});
test("permissions, current rubric, full month, saved timestamp, fresh baseline and canonical evidence remain required", () => {
  for (const permission of ["benchmarking", "outcomeResearch"] as const) {
    const c = source();
    c[permission] = false;
    assert.equal(project(c), null);
  }
  const rolling = source();
  Object.assign(rolling.periods[0] as object, {
    startDate: "2026-09-02",
    endDate: "2026-09-30",
  });
  assert.equal(project(rolling), null);
  const annual = source();
  Object.assign(annual.periods[0] as object, {
    startDate: "2026-01-01",
    endDate: "2026-09-30",
  });
  assert.equal(project(annual), null);
  const after = source();
  after.baselines[0].savedAt = "2026-09-01T00:00:01.000Z";
  assert.equal(project(after), null);
  const stale = source();
  (stale.baselines[0].report as SavedAssessment).createdAt =
    "2026-01-01T00:00:00.000Z";
  assert.equal(project(stale), null);
  const otherRelease = structuredClone(DEFAULT_RELEASE);
  otherRelease.id = "review-needed-r2";
  assert.equal(
    projectPracticeBenchmarkSource(source(), otherRelease, key, now),
    null,
  );
});
test("earliest qualifying period is retained even if unknown or unclassified; no favorable later substitution", () => {
  const c = source();
  const p = c.periods[0] as Record<string, unknown>;
  p.inquiries = null;
  p.contacted = null;
  p.booked = null;
  p.attended = null;
  p.clients = null;
  p.cohortBilledMinor = null;
  p.cohortCollectedMinor = null;
  p.adminHours = null;
  p.leadSpendMinor = 1000; // Period is nonempty while all three published metrics remain unknown.
  c.periods.push({
    ...p,
    id: uuid(5001),
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    inquiries: 100,
    clients: 20,
  });
  const laterNow = new Date("2026-11-02T12:00:00.000Z");
  const result = projectPracticeBenchmarkSource(
    c,
    DEFAULT_RELEASE,
    key,
    laterNow,
  );
  assert.ok(result);
  assert.equal(result.periodStart, "2026-09-01");
  assert.deepEqual(Object.values(result.outcomes), [null, null, null]);
  const laterBaseline = structuredClone(c.baselines[0]);
  laterBaseline.id = uuid(8001);
  laterBaseline.savedAt = "2026-09-30T12:30:00.000Z";
  const laterReport = laterBaseline.report as SavedAssessment;
  laterReport.id = uuid(8002);
  laterReport.createdAt = "2026-09-30T12:00:00.000Z";
  laterReport.assessment.contextSnapshot.practiceArea = "Business law";
  c.baselines.push(laterBaseline);
  (c.periods[1] as Record<string, unknown>).baselineReportId = laterBaseline.id;
  (
    c.baselines[0].report as SavedAssessment
  ).assessment.contextSnapshot.practiceArea = "Other";
  assert.equal(
    projectPracticeBenchmarkSource(c, DEFAULT_RELEASE, key, laterNow),
    null,
  );
});
test("one workspace contributes once; duplicate or overlapping source observations fail closed", () => {
  const c = source();
  assert.equal(
    practiceBenchmarkDataset([c, c], DEFAULT_RELEASE, key, now).incomplete,
    true,
  );
  c.periods.push(structuredClone(c.periods[0]));
  assert.equal(project(c), null);
  const duplicate = observations(30);
  duplicate[29].workspaceKey = duplicate[0].workspaceKey;
  assert.equal(summarize(duplicate).publicationEnabled, false);
});
test("genuinely registered period takes priority without pooling tracks; hash mismatch cannot become prospective", () => {
  const c = source();
  const base = c.baselines[0];
  c.plans = [
    {
      id: uuid(6001),
      revision: 1,
      requestId: uuid(7001),
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      source: "self_reported",
      currency: "USD",
      baselineReportId: base.id,
      baselineReleaseId: DEFAULT_RELEASE.id,
      baselineStage: SAMPLE_CONTEXT.stage,
      baselineFeeModel: SAMPLE_CONTEXT.feeModel,
      status: "reported",
      outcomeId: uuid(1001),
      createdAt: "2026-08-31T13:00:00.000Z",
      updatedAt: "2026-10-01T12:00:00.000Z",
      reportedAt: "2026-10-01T12:00:00.000Z",
      withdrawnAt: null,
      baselineContentHash: base.contentHash,
    },
  ];
  assert.equal(project(c)?.provenance, "preregistered");
  (c.plans[0] as Record<string, unknown>).baselineContentHash = "b".repeat(64);
  assert.equal(project(c), null);
});
test("29 known workspaces withhold, 30 publish only rounded safe summaries and bands", () => {
  assert.deepEqual(summarize(observations(29)).cohorts, []);
  const result = summarize();
  assert.equal(result.status, "descriptive");
  assert.equal(result.minimumKnownWorkspaces, 30);
  assert.equal(result.cohorts[0].workspacesBand, "30–39");
  assert.equal(result.cohorts[0].metrics[0].median, 25);
  assert.equal(result.cohorts[0].metrics[1].median, 80);
  assert.equal(result.cohorts[0].metrics[2].median, 2);
  const json = JSON.stringify(result);
  for (const forbidden of [
    "workspaceKey",
    "PRIVATE",
    key(uuid(1)),
    'outcomes":',
    "baselines",
    "contentHash",
  ])
    assert.equal(json.includes(forbidden), false, forbidden);
});
test("per-metric missingness abstains; unknown/zero-denominator is not zero, known zero remains zero", () => {
  const rows = observations(30);
  rows[0].outcomes.inquiry_client_fraction = null;
  const result = summarize(rows);
  assert.equal(result.cohorts[0].metrics[0].median, null);
  assert.equal(result.cohorts[0].metrics[0].knownWorkspacesBand, null);
  assert.equal(result.cohorts[0].metrics[1].median, 80);
  const c = source();
  Object.assign(c.periods[0] as object, {
    inquiries: 0,
    contacted: 0,
    booked: 0,
    attended: 0,
    clients: 0,
    cohortBilledMinor: 0,
    cohortCollectedMinor: 0,
    adminHours: 0,
  });
  assert.deepEqual(project(c)?.outcomes, {
    inquiry_client_fraction: null,
    billed_collection_fraction: null,
    owner_admin_hours_day: 0,
  });
  Object.assign(c.periods[0] as object, {
    inquiries: 100,
    cohortBilledMinor: 10000,
  });
  assert.deepEqual(project(c)?.outcomes, {
    inquiry_client_fraction: 0,
    billed_collection_fraction: 0,
    owner_admin_hours_day: 0,
  });
});
test("every comparison dimension separates samples instead of rescuing a small cohort", () => {
  const changes = [
    { group: "business" },
    { stage: "new" },
    { feeModel: "flat" },
    { source: "export" },
    { currency: "CAD" },
    { provenance: "preregistered" },
    { periodStart: "2026-08-01", periodEnd: "2026-08-31" },
  ] as const;
  for (const change of changes) {
    const rows = observations(30);
    Object.assign(rows[29], change);
    assert.deepEqual(summarize(rows).cohorts, [], JSON.stringify(change));
  }
  for (const change of [
    { releaseId: "other" },
    { mappingVersion: "unreviewed-edition" },
    { periodStart: "2026-09-02" },
  ]) {
    const rows = observations(30);
    Object.assign(rows[29], change);
    assert.equal(summarize(rows).publicationEnabled, false);
  }
});
test("all score-band cells must have five known workspaces; complete breakdown withheld if any cell is small", () => {
  const rows = observations(30);
  rows.forEach((r, i) => (r.score = i < 4 ? 40 : i < 17 ? 70 : 90));
  assert.deepEqual(summarize(rows).cohorts[0].metrics[0].scoreBands, []);
  rows.forEach((r, i) => (r.score = i < 5 ? 40 : i < 15 ? 70 : 90));
  assert.deepEqual(
    summarize(rows).cohorts[0].metrics[0].scoreBands.map(
      (b) => b.knownWorkspacesBand,
    ),
    ["5–9", "10–14", "15–19"],
  );
});
test("truncated extracts, mixed rubric/edition, invalid numbers and unknown future releases cannot publish", () => {
  assert.equal(summarize(observations(30), true).status, "unavailable");
  for (const value of [NaN, Infinity, -0.1, 1.1]) {
    const rows = observations(30);
    rows[0].outcomes.inquiry_client_fraction = value;
    assert.equal(summarize(rows).publicationEnabled, false);
  }
  for (const dates of [
    { periodStart: "2026-11-01", periodEnd: "2026-11-30" },
    { periodStart: "2025-01-01", periodEnd: "2025-01-31" },
  ]) {
    const rows = observations(30);
    Object.assign(rows[0], dates);
    assert.equal(summarize(rows).publicationEnabled, false);
  }
  const result = practiceBenchmarkSummary(
    { observations: observations(100), incomplete: false },
    "new-release",
    now,
  );
  assert.equal(result.mappingSupported, false);
  assert.deepEqual(result.cohorts, []);
});
