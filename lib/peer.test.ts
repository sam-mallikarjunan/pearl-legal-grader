import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "./catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "./demo";
import { assessPractice } from "./scoring";
import type { SavedAssessment } from "./storage";
import { benchmarkAvailability, privateSharePreview } from "./peer";
import { GET } from "../app/api/benchmarks/route";
import type { WebsiteScanResult } from "./website/types";

function assessment(): SavedAssessment {
  return {
    id: "private-report",
    practiceId: "private-owner",
    createdAt: "2026-10-16T12:30:00.000Z",
    label: "Private firm label",
    isSample: false,
    assessment: assessPractice({
      context: {
        ...SAMPLE_CONTEXT,
        websiteUrl: "https://private-label.example",
      },
      answers: SAMPLE_ANSWERS,
      controls: SAMPLE_CONTROLS,
      release: DEFAULT_RELEASE,
    }),
  };
}

test("peer availability exposes no invented cohort, rank, percentile or raw participant data", async () => {
  const expected = benchmarkAvailability();
  assert.equal(expected.status, "insufficient_data");
  assert.equal(expected.publicationEnabled, false);
  for (const field of [
    "n",
    "participants",
    "percentile",
    "rank",
    "distribution",
    "firms",
  ])
    assert.equal(field in expected, false, field);
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), expected);
});

test("private recognition remains a scoped draft and excludes identity and sensitive answers", () => {
  const entry = assessment();
  const unchanged = JSON.stringify(entry);
  const draft = privateSharePreview(entry)!;
  assert.equal(draft.privateOnly, true);
  assert.equal(draft.scope, "Owner-reported readiness");
  assert.equal(draft.score, entry.assessment.overallScore);
  assert.equal(draft.coverage, entry.assessment.coverage);
  for (const forbidden of [
    "private-label.example",
    "Private firm label",
    "private-owner",
    "controlsSnapshot",
    "answersSnapshot",
    "client_funds",
    "accessToken",
  ])
    assert.equal(JSON.stringify(draft).includes(forbidden), false, forbidden);
  assert.equal(JSON.stringify(entry), unchanged);
  entry.isSample = true;
  assert.equal(privateSharePreview(entry), null);
});

test("website recognition uses the scan method, date and coverage instead of owner-reported grade", () => {
  const entry = assessment();
  entry.websiteScan = {
    score: 62.5,
    coverage: 85,
    rubricVersion: "website-rubric-v1",
    completedAt: "2026-10-15T12:30:00.000Z",
  } as WebsiteScanResult;
  const draft = privateSharePreview(entry)!;
  assert.equal(draft.scope, "Observed website checks");
  assert.equal(draft.score, 62.5);
  assert.equal(draft.coverage, 0.85);
  assert.equal(draft.asOf, entry.websiteScan.completedAt);
  assert.equal(draft.releaseLabel, "website-rubric-v1");
  entry.websiteScan.score = null;
  assert.equal(privateSharePreview(entry)!.scope, "Owner-reported readiness");
});
