import { strict as assert } from "node:assert";
import { test } from "node:test";
import { actionObservationFixtures } from "./action-observation-test-fixtures";
import {
  MONTHLY_BRIEF_DECISIONS,
  buildMonthlyPracticeBriefs,
  parseMonthlyBriefDecision,
  type MonthlyBriefSavedDecision,
} from "./monthly-practice-brief";
import type { OutcomePlan } from "./outcome-plans";

const closed = new Date("2026-12-02T12:00:00Z");
const reportedAt = "2026-12-01T12:00:00Z";

function measured() {
  const f = actionObservationFixtures();
  const plan: OutcomePlan = {
    ...f.plan,
    outcomeId: f.followup.id,
    revision: 1,
    status: "reported",
    reportedAt,
  };
  return {
    f,
    plan,
    context: {
      observations: [f.observation],
      plans: [plan],
      baselines: [f.baseline],
      followups: [f.followup],
    },
  };
}

test("a closed brief uses registered evidence and exposes counts, source, and one exact write anchor", () => {
  const { f, context } = measured();
  const { briefs } = buildMonthlyPracticeBriefs(context, [], closed);
  assert.equal(briefs.length, 1);
  const [brief] = briefs;
  assert.equal(brief.status, "descriptive");
  assert.equal(brief.baseline.value, 80);
  assert.equal(brief.baseline.numerator, 80000);
  assert.equal(brief.followup?.denominator, 100000);
  assert.equal(brief.followup?.value, 90);
  assert.equal(brief.delta, 10);
  assert.equal(brief.direction, "higher");
  assert.equal(brief.window.source, "self_reported");
  assert.equal(brief.baselineWindow.startDate, f.baseline.startDate);
  assert.deepEqual(brief.availableDecisions, [...MONTHLY_BRIEF_DECISIONS]);
  assert.deepEqual(brief.evidence, {
    observationRevision: 0,
    planRevision: 1,
    baselineRevision: 0,
    followupId: f.followup.id,
    followupRevision: 0,
  });
  assert.equal(brief.decision, null);
  assert.ok(!("context" in brief));
  assert.ok(!("reportId" in brief));
});

test("the final UTC day is still pending, then one explicit missing-evidence choice opens", () => {
  const { f, context } = measured();
  context.plans = [f.plan];
  context.followups = [];
  const pending = buildMonthlyPracticeBriefs(
    context,
    [],
    new Date("2026-11-30T23:59:59Z"),
  ).briefs[0];
  assert.equal(pending.status, "waiting");
  assert.equal(pending.evidence, null);
  assert.deepEqual(pending.availableDecisions, []);
  const missing = buildMonthlyPracticeBriefs(
    context,
    [],
    new Date("2026-12-01T00:00:00Z"),
  ).briefs[0];
  assert.equal(missing.status, "unreported");
  assert.deepEqual(missing.availableDecisions, ["need_more_data"]);
  assert.equal(missing.evidence?.followupId, null);
  assert.equal(missing.evidence?.followupRevision, null);
});

test("unknown or mismatched follow-ups are never silently replaced or treated as zero", () => {
  const { f, context } = measured();
  context.followups = [
    { ...f.followup, cohortBilledMinor: 0, cohortCollectedMinor: 0 },
  ];
  const insufficient = buildMonthlyPracticeBriefs(context, [], closed)
    .briefs[0];
  assert.equal(insufficient.status, "unknown");
  assert.equal(insufficient.followup?.denominator, 0);
  assert.equal(insufficient.followup?.value, null);
  assert.equal(insufficient.delta, null);
  assert.deepEqual(insufficient.availableDecisions, ["need_more_data"]);
  context.followups = [
    { ...f.followup, id: "f2e7c404-d724-4917-a092-b3760e7d6375" },
  ];
  const mismatch = buildMonthlyPracticeBriefs(context, [], closed).briefs[0];
  assert.equal(mismatch.status, "unknown");
  assert.equal(mismatch.followup, null);
  assert.equal(mismatch.evidence, null);
});

test("correction, check-in, baseline revision, and withdrawal never inherit the old decision", () => {
  const { f, context } = measured();
  const original = buildMonthlyPracticeBriefs(context, [], closed).briefs[0];
  const decision: MonthlyBriefSavedDecision = {
    observationId: original.observationId,
    choice: "keep",
    evidence: original.evidence!,
    revision: 0,
    savedAt: closed.toISOString(),
  };
  const brief = () =>
    buildMonthlyPracticeBriefs(context, [decision], closed).briefs[0];
  assert.equal(brief().decision?.current, true);
  context.followups[0] = {
    ...f.followup,
    revision: 1,
    cohortCollectedMinor: 99000,
  };
  assert.equal(brief().followup?.value, 99);
  assert.equal(brief().decision?.current, false);
  context.followups[0] = f.followup;
  context.observations[0] = {
    ...f.observation,
    revision: 1,
    implementation: "not_implemented",
  };
  assert.equal(brief().decision?.current, false);
  context.observations[0] = f.observation;
  context.baselines[0] = { ...f.baseline, revision: 1 };
  assert.equal(brief().status, "baseline_changed");
  assert.equal(brief().evidence, null);
  assert.equal(brief().decision?.current, false);
  context.observations[0] = { ...f.observation, status: "withdrawn" };
  assert.equal(brief().status, "withdrawn");
  assert.equal(brief().decision?.current, false);
});

test("saving accepts only bounded enums and exact metadata, with no owner override or notes", () => {
  const { context } = measured();
  const brief = buildMonthlyPracticeBriefs(context, [], closed).briefs[0];
  const valid = {
    observationId: brief.observationId,
    choice: "adjust",
    expectedDecisionRevision: null,
    evidence: brief.evidence!,
  };
  assert.deepEqual(parseMonthlyBriefDecision(valid), valid);
  for (const invalid of [
    { ...valid, ownerUserId: brief.observationId },
    { ...valid, notes: "unsupported" },
    { ...valid, choice: "confirmed_impact" },
    { ...valid, expectedDecisionRevision: 1000001 },
    { ...valid, evidence: { ...valid.evidence, followupId: null } },
    { ...valid, evidence: { ...valid.evidence, baselineRevision: -1 } },
    { ...valid, evidence: { ...valid.evidence, hiddenTotals: 5 } },
  ])
    assert.throws(() => parseMonthlyBriefDecision(invalid));
});
