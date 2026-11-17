import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  actionObservationFixtures,
  actionObservationNow as now,
} from "./action-observation-test-fixtures";
import { improvementBaselines, improvementWindows } from "./first-improvement";

test("guided baseline admits known closed calendar months with compatible scope, not a rolling or foreign-practice comparison", () => {
  const { report, baseline } = actionObservationFixtures();
  const other = {
    ...report,
    id: "d3b8e07b-931c-4688-8f60-1d3efa3aba7d",
    snapshot: {
      ...report.snapshot,
      practiceId: "d0cce4b2-1c40-4ac5-a50f-e5836f56035e",
    },
  };
  const newer = {
    ...report,
    id: "105885ba-3c35-488c-81cb-d2706ae1130c",
  };
  const linkedForeign = { ...baseline, baselineReportId: other.id };
  const linkedSame = { ...baseline, baselineReportId: newer.id };
  const rolling = { ...baseline, startDate: "2026-08-31" };
  const notClosed = {
    ...baseline,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  };
  const unknown = {
    ...baseline,
    inquiries: null,
    clients: null,
    cohortBilledMinor: null,
    adminHours: null,
  };
  assert.deepEqual(
    improvementBaselines(
      report,
      [report, other, newer],
      [baseline, linkedForeign, rolling, unknown, notClosed, linkedSame],
      now,
    ),
    [baseline, linkedSame],
  );
});

test("guided scheduling resumes only the exact registered open plan and skips occupied or incompatible months", () => {
  const { report, baseline, plan, followup } = actionObservationFixtures();
  const future = improvementWindows(report, baseline, [], [], now);
  assert.deepEqual(future[0], {
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    existingPlan: null,
  });
  assert.deepEqual(improvementWindows(report, baseline, [plan], [], now)[0], {
    ...future[0],
    existingPlan: plan,
  });
  assert.equal(
    improvementWindows(
      report,
      baseline,
      [{ ...plan, currency: "GBP" }],
      [],
      now,
    )[0].startDate,
    "2026-12-01",
  );
  assert.equal(
    improvementWindows(report, baseline, [plan], [followup], now)[0].startDate,
    "2026-12-01",
  );
  assert.deepEqual(
    improvementWindows(
      report,
      baseline,
      [{ ...plan, status: "withdrawn" }],
      [],
      now,
    )[0],
    future[0],
  );
});

test("new guided scheduling honors the frozen 90-day assessment window before offering a new month", () => {
  const { report, baseline } = actionObservationFixtures();
  const old = {
    ...report,
    snapshot: { ...report.snapshot, createdAt: "2026-08-02T23:59:59Z" },
  };
  const onBoundary = {
    ...report,
    snapshot: { ...report.snapshot, createdAt: "2026-08-03T00:00:00Z" },
  };
  assert.equal(improvementWindows(old, baseline, [], [], now).length, 0);
  assert.deepEqual(
    improvementWindows(onBoundary, baseline, [], [], now).map(
      (w) => w.startDate,
    ),
    ["2026-11-01"],
  );
});
