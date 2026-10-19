import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  decodeOutcomePlan,
  parseOutcomePlanInput,
  parseOutcomePlanReport,
  parseOutcomePlanRevision,
  type OutcomePlan,
} from "./outcome-plans";
const now = new Date("2026-10-19T12:00:00Z");
const id = "72deca47-3878-4ce7-acce-fd5e8949589f";
const input = {
  requestId: id,
  expectedReleaseId: "preview-r1",
  baselineReportId: id,
  startDate: "2026-11-01",
  endDate: "2026-11-30",
  source: "self_reported" as const,
  currency: "USD" as const,
};
const plan: OutcomePlan = {
  ...input,
  id,
  revision: 0,
  baselineReleaseId: "preview-r1",
  baselineStage: "established",
  baselineFeeModel: "hourly",
  status: "registered",
  outcomeId: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  reportedAt: null,
  withdrawnAt: null,
};
test("plan registration validates exact future calendar windows and strict owned-reference input", () => {
  assert.equal(parseOutcomePlanInput(input, now).endDate, "2026-11-30");
  for (const changes of [
    { startDate: "2026-10-19", endDate: "2026-11-17" },
    { startDate: "2026-11-01", endDate: "2026-11-27" },
    { endDate: "2026-12-02" },
    { startDate: "2027-11-01", endDate: "2027-11-30" },
    { startDate: "2026-02-30" },
    { currency: "BTC" },
    { ownerId: id },
    { registeredAt: "2026-01-01" },
    { baselineReportId: null },
  ])
    assert.throws(() => parseOutcomePlanInput({ ...input, ...changes }, now));
  assert.equal(
    parseOutcomePlanInput(input, new Date("2026-12-19"), true).requestId,
    id,
  );
});
test("report derives frozen fields, allows nullable numeric corrections, never accepts metadata or free text", () => {
  const result = parseOutcomePlanReport(
    { revision: 0, values: { inquiries: 0, clients: 0, adminHours: 0 } },
    plan,
    new Date("2026-12-01"),
  );
  assert.equal(result.period.currency, "USD");
  assert.equal(result.period.baselineReportId, id);
  assert.equal(result.values.inquiries, 0);
  assert.equal(result.values.cohortBilledMinor, null);
  for (const values of [
    { inquiries: 5, clients: 6 },
    { notes: "secret" },
    { source: "export" },
    { adminHours: 721 },
    {},
  ])
    assert.throws(() =>
      parseOutcomePlanReport(
        { revision: 0, values },
        plan,
        new Date("2026-12-01"),
      ),
    );
  assert.throws(() =>
    parseOutcomePlanReport(
      { revision: 0, values: { inquiries: 1 }, startDate: "forged" },
      plan,
      new Date("2026-12-01"),
    ),
  );
});
test("report cannot start early or reopen a withdrawn or deleted-baseline plan", () => {
  assert.throws(
    () =>
      parseOutcomePlanReport(
        { revision: 0, values: { inquiries: 1 } },
        plan,
        now,
      ),
    (e) =>
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      e.code === "outcome_plan_not_closed",
  );
  assert.throws(() =>
    parseOutcomePlanReport(
      { revision: 1, values: { inquiries: 1 } },
      { ...plan, status: "withdrawn", withdrawnAt: now.toISOString() },
      new Date("2026-12-01"),
    ),
  );
});
test("stored plan projection validates timestamp provenance and terminal states", () => {
  assert.equal(decodeOutcomePlan(plan).status, "registered");
  assert.equal("expectedReleaseId" in decodeOutcomePlan(plan), false);
  for (const changed of [
    { createdAt: "2026-11-01T00:00:00Z" },
    { status: "reported" },
    { status: "withdrawn" },
    { baselineReportId: null },
    { revision: -1 },
    { endDate: "2026-12-15" },
  ])
    assert.throws(() => decodeOutcomePlan({ ...plan, ...changed }));
  assert.equal(
    decodeOutcomePlan({
      ...plan,
      status: "withdrawn",
      baselineReportId: null,
      withdrawnAt: now.toISOString(),
    }).baselineReportId,
    null,
  );
  assert.equal(parseOutcomePlanRevision({ revision: 2 }), 2);
  assert.throws(() => parseOutcomePlanRevision({ revision: 2, ownerId: id }));
});
