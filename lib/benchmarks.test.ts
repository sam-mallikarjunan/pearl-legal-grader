import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  calculateCashLockup,
  calculateFunnel,
  INDUSTRY_BENCHMARKS,
  parseBenchmarkNumber,
  searchIndustryBenchmarks,
} from "./benchmarks";
import { publicBenchmarkSummary } from "./benchmarks-public";
import type { ResearchRow } from "./research";
import { DOMAIN_IDS } from "./types";

function row(index: number): ResearchRow {
  return {
    workspacePseudonym: `private-hmac-${index}`,
    stage: "established",
    feeModel: "hourly",
    goal: "less_admin",
    releaseId: "published-v1",
    assessmentMonth: "2026-10",
    domains: DOMAIN_IDS.map((id) => ({
      id,
      score: index % 2 ? 71 : 82,
      coverage: 1,
    })),
    reportedOutcomes: { improved: 0, no_change: 0, worse: 0, unsure: 0 },
  };
}
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i));

test("public benchmarks suppress 29 and publish rounded descriptors at 30 distinct same-release workspaces", () => {
  const small = publicBenchmarkSummary(rows(29), "published-v1");
  assert.equal(small.status, "insufficient_data");
  assert.equal(small.cohortSizeBand, null);
  assert.deepEqual(small.domains, []);
  const enough = publicBenchmarkSummary(rows(30), "published-v1");
  assert.equal(enough.status, "descriptive");
  assert.equal(enough.cohortSizeBand, "30–39");
  assert.equal(enough.domains[0].medianScore, 75);
  assert.equal(enough.domains[0].unit, "rubric points out of 100");
  assert.equal(
    enough.domains.every((d) => d.status === "descriptive"),
    true,
  );
  const json = JSON.stringify(enough);
  assert.equal(json.includes("private-hmac"), false);
  for (const forbidden of [
    "workspacePseudonym",
    "reportedOutcomes",
    "assessmentMonth",
    "feeModel",
    "stage",
    "percentile",
  ]) {
    assert.equal(json.includes(`"${forbidden}":`), false, forbidden);
  }
});

test("mixed releases, truncated pagination, duplicates, and invalid values all fail closed", () => {
  const mixed = rows(31);
  mixed[30].releaseId = "older-v0";
  assert.equal(
    publicBenchmarkSummary(mixed, "published-v1").status,
    "insufficient_data",
  );
  assert.equal(
    publicBenchmarkSummary(rows(500), "published-v1", true).status,
    "insufficient_data",
  );
  assert.equal(
    publicBenchmarkSummary([...rows(30), row(0)], "published-v1").status,
    "insufficient_data",
  );
  assert.equal(
    publicBenchmarkSummary(rows(30), null).status,
    "insufficient_data",
  );
  for (const bad of [NaN, Infinity, -1, 101]) {
    const malformed = rows(30);
    malformed[0].domains[0].score = bad;
    assert.equal(
      publicBenchmarkSummary(malformed, "published-v1").status,
      "insufficient_data",
    );
  }
});

test("each metric needs 30 known values; unknown is suppressed rather than zero", () => {
  const input = rows(30);
  input[0].domains[0].score = null;
  const result = publicBenchmarkSummary(input, "published-v1");
  assert.equal(result.status, "descriptive");
  assert.deepEqual(result.domains[0], {
    id: "presence",
    status: "suppressed",
    medianScore: null,
    unit: "rubric points out of 100",
    cohortSizeBand: null,
  });
  for (const r of input)
    r.domains.forEach((d) => {
      d.score = null;
    });
  assert.equal(
    publicBenchmarkSummary(input, "published-v1").status,
    "insufficient_data",
  );
  const zero = rows(30);
  zero.forEach((r) =>
    r.domains.forEach((d) => {
      d.score = 0;
    }),
  );
  assert.equal(
    publicBenchmarkSummary(zero, "published-v1").domains[0].medianScore,
    0,
  );
});

test("funnel math keeps cohort denominators distinct and refuses impossible counts", () => {
  assert.deepEqual(
    calculateFunnel({
      spend: 2000,
      leads: 100,
      booked: 40,
      showed: 30,
      clients: 12,
    }),
    {
      costPerLead: 20,
      costPerClient: 2000 / 12,
      bookingRate: 0.4,
      showRate: 0.75,
      retentionRate: 0.4,
      leadToClientRate: 0.12,
    },
  );
  assert.equal(
    calculateFunnel({ spend: 1, leads: 10, booked: 11, showed: 5, clients: 1 }),
    null,
  );
  assert.equal(
    calculateFunnel({
      spend: 1,
      leads: 10,
      booked: null,
      showed: null,
      clients: 11,
    }),
    null,
  );
  assert.equal(
    calculateFunnel({ spend: -1, leads: 10, booked: 2, showed: 1, clients: 1 }),
    null,
  );
  assert.equal(
    calculateFunnel({ spend: 1, leads: 1.5, booked: 1, showed: 1, clients: 1 }),
    null,
  );
  const absent = calculateFunnel({
    spend: null,
    leads: null,
    booked: null,
    showed: null,
    clients: null,
  })!;
  assert.equal(
    Object.values(absent).every((n) => n === null),
    true,
  );
  assert.equal(
    calculateFunnel({ spend: 0, leads: 10, booked: 0, showed: 0, clients: 0 })
      ?.costPerLead,
    0,
  );
  assert.equal(
    calculateFunnel({ spend: 100, leads: 0, booked: 0, showed: 0, clients: 0 })
      ?.costPerLead,
    null,
  );
});

test("cash calculator uses 365-day prior-year collections basis and preserves missing amounts", () => {
  assert.deepEqual(
    calculateCashLockup({
      workInProgress: 10000,
      receivables: 20000,
      annualCollections: 365000,
    }),
    { realizationDays: 10, collectionDays: 20, totalDays: 30 },
  );
  assert.deepEqual(
    calculateCashLockup({
      workInProgress: null,
      receivables: 20000,
      annualCollections: 365000,
    }),
    { realizationDays: null, collectionDays: 20, totalDays: null },
  );
  assert.deepEqual(
    calculateCashLockup({
      workInProgress: 10000,
      receivables: 20000,
      annualCollections: 0,
    }),
    { realizationDays: null, collectionDays: null, totalDays: null },
  );
  assert.equal(
    calculateCashLockup({
      workInProgress: Infinity,
      receivables: 1,
      annualCollections: 1,
    }),
    null,
  );
  assert.equal(parseBenchmarkNumber(""), null);
  assert.equal(parseBenchmarkNumber("-1"), null);
  assert.equal(parseBenchmarkNumber("1e99"), null);
  assert.equal(parseBenchmarkNumber("0"), 0);
  assert.equal(parseBenchmarkNumber("12.50"), 12.5);
});

test("reference catalog preserves sources, unknown denominators, observed/guidance distinction, and searchable topic filters", () => {
  assert.equal(INDUSTRY_BENCHMARKS.length, 12);
  assert.equal(new Set(INDUSTRY_BENCHMARKS.map((b) => b.id)).size, 12);
  for (const b of INDUSTRY_BENCHMARKS) {
    assert.equal(new URL(b.source.url).protocol, "https:");
    assert.equal(b.source.accessedAt, "2026-10-19");
    for (const value of [
      b.unit,
      b.cohort,
      b.period,
      b.denominator,
      b.limitation,
    ])
      assert.ok(value.length > 10);
  }
  assert.equal(searchIndustryBenchmarks("", "Website", "guidance").length, 3);
  assert.equal(
    searchIndustryBenchmarks("AI", "Technology", "observed").length,
    2,
  );
  assert.equal(searchIndustryBenchmarks("wombat").length, 0);
  assert.equal(
    INDUSTRY_BENCHMARKS.find(
      (b) => b.id === "total-lockup",
    )?.limitation.includes("median"),
    true,
  );
});
