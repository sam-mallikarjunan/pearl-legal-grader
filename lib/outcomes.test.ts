import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  calculateOutcomeMetrics,
  OUTCOME_RESEARCH_VERSION,
  outcomePeriodDays,
  outcomePeriodsOverlap,
  parseOutcomeConsent,
  parseOutcomePeriodInput,
  parseOutcomeRevision,
} from "./outcomes";
const now = new Date("2026-10-19T15:00:00Z");
const period = {
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  source: "self_reported",
  currency: "USD",
  inquiries: 100,
  contacted: 80,
  booked: 40,
  attended: 30,
  clients: 10,
  leadSpendMinor: 100000,
  cohortBilledMinor: 800000,
  cohortCollectedMinor: 600000,
  adminHours: 15.25,
};
test("unknown measures normalize to null and never silently become zero", () => {
  const parsed = parseOutcomePeriodInput(
    {
      startDate: period.startDate,
      endDate: period.endDate,
      source: "self_reported",
      currency: "USD",
      inquiries: 0,
    },
    now,
  );
  assert.equal(parsed.inquiries, 0);
  assert.equal(parsed.clients, null);
  assert.equal(parsed.leadSpendMinor, null);
  assert.equal(parsed.adminHours, null);
  assert.equal(parsed.baselineReportId, null);
});
test("closed inclusive date bounds accept real leap days and exactly7/366days", () => {
  assert.equal(outcomePeriodDays("2024-01-01", "2024-12-31"), 366);
  assert.equal(outcomePeriodDays("2026-09-01", "2026-09-07"), 7);
  assert.doesNotThrow(() =>
    parseOutcomePeriodInput(
      { ...period, startDate: "2024-01-01", endDate: "2024-12-31" },
      now,
    ),
  );
  for (const dates of [
    { startDate: "2026-09-01", endDate: "2026-09-06" },
    { startDate: "2024-01-01", endDate: "2025-01-01" },
    { startDate: "2026-02-30", endDate: "2026-03-10" },
    { startDate: "2026-10-01", endDate: "2026-10-19" },
    { startDate: "2026-10-01", endDate: "2026-10-20" },
    { startDate: "2026-09-30", endDate: "2026-09-01" },
  ])
    assert.throws(() => parseOutcomePeriodInput({ ...period, ...dates }, now));
});
test("all known funnel stages stay monotone even when an intermediate count is unknown", () => {
  assert.doesNotThrow(() =>
    parseOutcomePeriodInput({ ...period, contacted: null, booked: 80 }, now),
  );
  for (const change of [
    { contacted: 101 },
    { booked: null, attended: 81 },
    { contacted: null, booked: null, attended: null, clients: 101 },
    { inquiries: 0, contacted: null, booked: null, attended: null, clients: 1 },
  ])
    assert.throws(() => parseOutcomePeriodInput({ ...period, ...change }, now));
});
test("money uses safe integer minor units and a single currency; collected never exceeds billed", () => {
  assert.throws(() =>
    parseOutcomePeriodInput({ ...period, cohortCollectedMinor: 800001 }, now),
  );
  for (const change of [
    { leadSpendMinor: 0.1 },
    { leadSpendMinor: -1 },
    { leadSpendMinor: 10000000001 },
    { currency: "BTC" },
    { currency: ["USD", "CAD"] },
  ])
    assert.throws(() => parseOutcomePeriodInput({ ...period, ...change }, now));
  assert.doesNotThrow(() =>
    parseOutcomePeriodInput({ ...period, cohortBilledMinor: null }, now),
  );
});
test("owner administration time is bounded by calendar hours and two decimal places", () => {
  assert.doesNotThrow(() =>
    parseOutcomePeriodInput({ ...period, adminHours: 30 * 24 }, now),
  );
  for (const adminHours of [-1, Infinity, NaN, 720.01, 1.001, "12"])
    assert.throws(() =>
      parseOutcomePeriodInput({ ...period, adminHours }, now),
    );
});
test("free text, identifying fields, forged ownership and wholly unknown periods are refused", () => {
  for (const extra of [
    { clientName: "PRIVATE" },
    { notes: "PRIVATE" },
    { ownerUserId: "forged" },
    { score: 100 },
    { clientDetails: {} },
  ])
    assert.throws(() => parseOutcomePeriodInput({ ...period, ...extra }, now));
  assert.throws(() =>
    parseOutcomePeriodInput(
      {
        startDate: period.startDate,
        endDate: period.endDate,
        source: "self_reported",
        currency: "USD",
      },
      now,
    ),
  );
  assert.throws(() =>
    parseOutcomePeriodInput({ ...period, inquiries: "100" }, now),
  );
});
test("derived metrics keep numerators/denominators aligned and zero denominators unknown", () => {
  const metrics = calculateOutcomeMetrics(parseOutcomePeriodInput(period, now));
  assert.equal(metrics.inquiryToClientRate, 0.1);
  assert.equal(metrics.contactRate, 0.8);
  assert.equal(metrics.bookingRate, 0.5);
  assert.equal(metrics.attendanceRate, 0.75);
  assert.equal(metrics.costPerClientMinor, 10000);
  assert.equal(metrics.collectionRate, 0.75);
  assert.equal(metrics.periodDays, 30);
  assert.ok(
    !("collectedPerClientMinor" in metrics),
    "Invoice-cohort cash must not be divided by inquiry-cohort clients.",
  );
  const empty = calculateOutcomeMetrics(
    parseOutcomePeriodInput(
      {
        ...period,
        inquiries: 0,
        contacted: 0,
        booked: 0,
        attended: 0,
        clients: 0,
        cohortBilledMinor: 0,
        cohortCollectedMinor: 0,
      },
      now,
    ),
  );
  assert.equal(empty.inquiryToClientRate, null);
  assert.equal(empty.collectionRate, null);
  assert.equal(empty.costPerClientMinor, null);
});
test("period overlap is inclusive; adjacent calendar periods are separate", () => {
  assert.equal(
    outcomePeriodsOverlap(period, {
      startDate: "2026-09-30",
      endDate: "2026-10-07",
    }),
    true,
  );
  assert.equal(
    outcomePeriodsOverlap(period, {
      startDate: "2026-10-01",
      endDate: "2026-10-07",
    }),
    false,
  );
  assert.equal(outcomePeriodsOverlap(period, period), true);
});
test("research consent is separately versioned and CAS-bound, rejecting old assessment permissions", () => {
  assert.deepEqual(
    parseOutcomeConsent({
      granted: true,
      revision: 0,
      consentVersion: OUTCOME_RESEARCH_VERSION,
    }),
    { granted: true, revision: 0 },
  );
  assert.deepEqual(
    parseOutcomeConsent({
      granted: false,
      revision: 1,
      consentVersion: OUTCOME_RESEARCH_VERSION,
    }),
    { granted: false, revision: 1 },
  );
  for (const change of [
    { consentVersion: "account-preferences-v1" },
    { revision: -1 },
    { granted: "true" },
    { marketing: true },
  ])
    assert.throws(() =>
      parseOutcomeConsent({
        granted: true,
        revision: 0,
        consentVersion: OUTCOME_RESEARCH_VERSION,
        ...change,
      }),
    );
  for (const value of [null, -1, 1.5, Infinity, 1000001])
    assert.throws(() => parseOutcomeRevision(value));
});
