import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  actionObservationFixtures,
  actionObservationUser,
} from "../action-observation-test-fixtures";
import {
  MONTHLY_BRIEF_VERSION,
  type MonthlyBriefDecisionInput,
  type MonthlyBriefSavedDecision,
} from "../monthly-practice-brief";
import { createMonthlyPracticeBriefStore } from "./monthly-practice-brief-store";

const now = () => new Date("2026-12-02T12:00:00Z");
const owner = actionObservationUser;

function fixtures() {
  const f = actionObservationFixtures();
  const decision: MonthlyBriefSavedDecision = {
    observationId: f.observation.id,
    choice: "keep",
    revision: 0,
    evidence: {
      observationRevision: 0,
      planRevision: 1,
      baselineRevision: 0,
      followupId: f.followup.id,
      followupRevision: 0,
    },
    savedAt: now().toISOString(),
  };
  const input: MonthlyBriefDecisionInput = {
    observationId: decision.observationId,
    choice: decision.choice,
    expectedDecisionRevision: null,
    evidence: decision.evidence,
  };
  const context = {
    observations: [f.observation],
    plans: [
      {
        ...f.plan,
        status: "reported",
        revision: 1,
        outcomeId: f.followup.id,
        reportedAt: now().toISOString(),
      },
    ],
    baselines: [f.baseline],
    followups: [{ ...f.followup, revision: 1 }],
  };
  return { input, decision, context };
}

test("owner read uses one native snapshot and compares the saved decision against current evidence", async () => {
  const { decision, context } = fixtures();
  const store = createMonthlyPracticeBriefStore(async (name, args) => {
    assert.equal(name, "grader_read_monthly_brief_context");
    assert.deepEqual(args, { p_user_id: owner });
    return {
      context,
      decisions: { version: MONTHLY_BRIEF_VERSION, decisions: [decision] },
    };
  }, now);
  const [brief] = (await store.read(owner)).briefs;
  assert.equal(brief.evidence?.followupRevision, 1);
  assert.equal(brief.decision?.current, false);
});

test("the native save receives only server-derived owner plus reviewed choice and revisions", async () => {
  const { input, decision } = fixtures();
  const calls: unknown[] = [];
  const store = createMonthlyPracticeBriefStore(async (name, args) => {
    calls.push({ name, args });
    return decision;
  }, now);
  const result = await store.decide(owner, input);
  assert.deepEqual(result, {
    choice: "keep",
    revision: 0,
    savedAt: decision.savedAt,
    current: true,
  });
  assert.deepEqual(calls, [
    {
      name: "grader_save_monthly_brief_decision",
      args: {
        p_user_id: owner,
        p_observation_id: input.observationId,
        p_choice: input.choice,
        p_expected_revision: null,
        p_evidence: input.evidence,
      },
    },
  ]);
  await assert.rejects(store.decide(owner, { ...input, owner }));
  assert.equal(calls.length, 1);
});

test("native conflicts never become optimistic success, unknown errors are opaque", async () => {
  const { input } = fixtures();
  for (const [code, status] of [
    ["monthly_brief_not_found", 404],
    ["monthly_brief_conflict", 409],
    ["monthly_brief_not_decidable", 409],
    ["secret native text", 503],
    ["constructor", 503],
  ] as const) {
    const store = createMonthlyPracticeBriefStore(
      async () => ({ error: code }),
      now,
    );
    await assert.rejects(
      store.decide(owner, input),
      (e: unknown) =>
        typeof e === "object" &&
        e !== null &&
        "status" in e &&
        e.status === status,
    );
  }
  const outage = createMonthlyPracticeBriefStore(async () => {
    throw new Error("secret credential");
  }, now);
  await assert.rejects(outage.read(owner), {
    name: "AccountDataError",
    status: 503,
    message: "The practice brief could not be loaded. Try again shortly.",
  });
});

test("export reads only decision metadata and rejects extra rows or private leaked fields", async () => {
  const { decision } = fixtures();
  const result = { version: MONTHLY_BRIEF_VERSION, decisions: [decision] };
  const store = createMonthlyPracticeBriefStore(async (name, args) => {
    assert.equal(name, "grader_read_monthly_brief_decisions");
    assert.deepEqual(args, { p_user_id: owner });
    return result;
  }, now);
  assert.deepEqual(await store.exportOwn(owner), result);
  result.decisions = [{ ...decision }, { ...decision }];
  await assert.rejects(store.exportOwn(owner));
  result.decisions = [
    { ...decision, rawTotals: "unsupported" } as MonthlyBriefSavedDecision,
  ];
  await assert.rejects(store.exportOwn(owner));
});
