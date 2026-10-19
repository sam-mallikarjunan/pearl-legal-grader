import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  ACTION_OBSERVATION_VERSION,
  parseActionObservationInput,
  parseActionCheckIn,
  parseActionConfounders,
  validateActionObservationRegistration,
  decodeActionObservation,
  buildActionObservationView,
  actionObservationInputMatches,
} from "./action-observations";
import {
  actionObservationFixtures as fixture,
  actionObservationNow as now,
} from "./action-observation-test-fixtures";
const code = (f: () => unknown, c: string) =>
  assert.throws(
    f,
    (e: unknown) =>
      typeof e === "object" && e !== null && "code" in e && e.code === c,
  );
const later = new Date("2026-12-02T12:00:00Z");
test("registration accepts only fixed IDs/revisions/enums and explicit private version, never free text or permissions", () => {
  const { input } = fixture();
  assert.deepEqual(parseActionObservationInput(input), input);
  for (const extra of [
    { clientName: "PRIVATE" },
    { notes: "PRIVATE" },
    { ownerUserId: "forged" },
    { research: true },
  ])
    assert.throws(() => parseActionObservationInput({ ...input, ...extra }));
  for (const patch of [
    { version: "outcome-research-consent-v1" },
    { metricId: "revenue_effect" },
    { planRevision: -1 },
    { baselineRevision: 1.5 },
    { changeStartDate: "2026-02-30" },
    { confounders: ["private text"] },
  ])
    assert.throws(() => parseActionObservationInput({ ...input, ...patch }));
  assert.equal(input.version, ACTION_OBSERVATION_VERSION);
});
test("only registration before both the planned change date and full future month qualifies", () => {
  const f = fixture();
  assert.equal(
    validateActionObservationRegistration(
      f.input,
      f.plan,
      f.report,
      f.baseline,
      null,
      now,
    ).value,
    80,
  );
  for (const patch of [
    { changeStartDate: "2026-10-19" },
    { changeStartDate: "2026-11-02" },
  ])
    code(
      () =>
        validateActionObservationRegistration(
          { ...f.input, ...patch },
          f.plan,
          f.report,
          f.baseline,
          null,
          now,
        ),
      "action_observation_not_prospective",
    );
  code(
    () =>
      validateActionObservationRegistration(
        f.input,
        { ...f.plan, startDate: "2026-11-02", endDate: "2026-12-01" },
        f.report,
        f.baseline,
        null,
        now,
      ),
    "action_observation_not_prospective",
  );
});
test("plan/baseline CAS, ownership action and canonical report are fresh registration gates", () => {
  const f = fixture();
  for (const [plan, report, baseline, expected] of [
    [{ ...f.plan, revision: 1 }, f.report, f.baseline, "revision_conflict"],
    [f.plan, f.report, { ...f.baseline, revision: 1 }, "revision_conflict"],
    [
      f.plan,
      { ...f.report, id: f.baseline.id },
      f.baseline,
      "action_observation_action_invalid",
    ],
    [
      f.plan,
      { ...f.report, snapshot: { ...f.report.snapshot, isSample: true } },
      f.baseline,
      "action_observation_action_invalid",
    ],
  ] as const)
    code(
      () =>
        validateActionObservationRegistration(
          f.input,
          plan,
          report,
          baseline,
          null,
          now,
        ),
      expected,
    );
  code(
    () =>
      validateActionObservationRegistration(
        { ...f.input, actionId: "not-issued" },
        f.plan,
        f.report,
        f.baseline,
        null,
        now,
      ),
    "action_observation_action_invalid",
  );
});
test("closed baseline requires compatible money/source/calendar windows and known positive denominator", () => {
  const f = fixture();
  for (const patch of [
    { currency: "GBP" },
    { source: "export" },
    { startDate: "2026-09-02", endDate: "2026-10-01" },
    { updatedAt: "2026-12-01T00:00:00Z" },
  ])
    code(
      () =>
        validateActionObservationRegistration(
          f.input,
          f.plan,
          f.report,
          { ...f.baseline, ...patch } as typeof f.baseline,
          null,
          now,
        ),
      "action_observation_baseline_invalid",
    );
  for (const patch of [
    { cohortCollectedMinor: null },
    { cohortBilledMinor: 0, cohortCollectedMinor: 0 },
  ])
    code(
      () =>
        validateActionObservationRegistration(
          f.input,
          f.plan,
          f.report,
          { ...f.baseline, ...patch },
          null,
          now,
        ),
      "action_observation_baseline_unknown",
    );
});
test("an unlinked baseline needs separate scope declaration and never writes a baseline link", () => {
  const f = fixture(),
    before = JSON.stringify(f.baseline);
  code(
    () =>
      validateActionObservationRegistration(
        { ...f.input, scopeDeclared: false },
        f.plan,
        f.report,
        f.baseline,
        null,
        now,
      ),
    "action_observation_scope_required",
  );
  validateActionObservationRegistration(
    f.input,
    f.plan,
    f.report,
    f.baseline,
    null,
    now,
  );
  assert.equal(JSON.stringify(f.baseline), before);
  const linked = { ...f.baseline, baselineReportId: f.report.id };
  assert.equal(
    validateActionObservationRegistration(
      { ...f.input, scopeDeclared: false },
      f.plan,
      f.report,
      linked,
      f.report,
      now,
    ).value,
    80,
  );
  const foreign = {
    ...f.report,
    snapshot: { ...f.report.snapshot, practiceId: f.baseline.id },
  };
  code(
    () =>
      validateActionObservationRegistration(
        f.input,
        f.plan,
        f.report,
        linked,
        foreign,
        now,
      ),
    "action_observation_baseline_invalid",
  );
});
test("frozen decoded registration excludes extra fields and rejects invented metric values", () => {
  const f = fixture();
  const read = decodeActionObservation({
    ...f.observation,
    requestHash: "PRIVATE",
    answers: { PRIVATE: true },
    action: { ...f.observation.action, extra: "PRIVATE" },
  });
  assert.ok(!JSON.stringify(read).includes("PRIVATE"));
  assert.equal(read.baseline.observation.value, 80);
  assert.throws(() =>
    decodeActionObservation({
      ...f.observation,
      baseline: {
        ...f.observation.baseline,
        observation: { ...f.observation.baseline.observation, value: 99 },
      },
    }),
  );
  assert.ok(actionObservationInputMatches(f.observation, f.input));
  assert.ok(
    !actionObservationInputMatches(f.observation, {
      ...f.input,
      metricId: "cost_per_client",
    }),
  );
});
test("future and closed-unreported windows remain pending; action completion dates cannot create results", () => {
  const f = fixture();
  assert.equal(
    buildActionObservationView(
      f.observation,
      f.plan,
      f.baseline,
      f.followup,
      0,
      now,
    ).comparison.status,
    "waiting",
  );
  assert.equal(
    buildActionObservationView(
      f.observation,
      f.plan,
      f.baseline,
      f.followup,
      0,
      later,
    ).comparison.status,
    "unreported",
  );
  assert.equal(
    buildActionObservationView(
      f.observation,
      f.plan,
      f.baseline,
      f.followup,
      0,
      new Date("2026-11-30T23:59:59Z"),
    ).comparison.delta,
    null,
  );
});
test("only the locked follow-up ID supplies a result; no favorable fallback after withdrawals/deletions", () => {
  const f = fixture(),
    p = {
      ...f.plan,
      status: "reported" as const,
      outcomeId: f.followup.id,
      reportedAt: f.followup.createdAt,
    };
  const good = buildActionObservationView(
    f.observation,
    p,
    f.baseline,
    f.followup,
    0,
    later,
  );
  assert.equal(good.comparison.delta, 10);
  assert.equal(good.comparison.direction, "higher");
  for (const followup of [
    null,
    { ...f.followup, id: f.baseline.id },
    { ...f.followup, currency: "GBP" as const },
  ])
    assert.equal(
      buildActionObservationView(
        f.observation,
        p,
        f.baseline,
        followup,
        0,
        later,
      ).comparison.status,
      "unknown",
    );
  assert.equal(
    buildActionObservationView(
      f.observation,
      { ...p, status: "withdrawn", withdrawnAt: later.toISOString() },
      f.baseline,
      f.followup,
      0,
      later,
    ).comparison.status,
    "plan_unavailable",
  );
  assert.equal(
    buildActionObservationView(
      {
        ...f.observation,
        status: "withdrawn",
        withdrawnAt: later.toISOString(),
      },
      p,
      f.baseline,
      f.followup,
      0,
      later,
    ).comparison.status,
    "withdrawn",
  );
});
test("edited or missing baselines abstain while retaining clearly historical frozen registration", () => {
  const f = fixture(),
    p = {
      ...f.plan,
      status: "reported" as const,
      outcomeId: f.followup.id,
      reportedAt: f.followup.createdAt,
    };
  for (const b of [
    null,
    { ...f.baseline, revision: 1 },
    { ...f.baseline, cohortCollectedMinor: 70000 },
  ]) {
    const result = buildActionObservationView(
      f.observation,
      p,
      b,
      f.followup,
      0,
      later,
    );
    assert.equal(result.comparison.status, "baseline_changed");
    assert.equal(result.comparison.delta, null);
    assert.equal(result.comparison.baseline.value, 80);
  }
  assert.equal(f.observation.baseline.revision, 0);
});
test("unknown follow-up/zero denominator abstains; numeric corrections stay revision labeled", () => {
  const f = fixture(),
    p = {
      ...f.plan,
      status: "reported" as const,
      outcomeId: f.followup.id,
      reportedAt: f.followup.createdAt,
    };
  for (const patch of [
    { cohortCollectedMinor: null },
    { cohortBilledMinor: 0, cohortCollectedMinor: 0 },
  ]) {
    const v = buildActionObservationView(
      f.observation,
      p,
      f.baseline,
      { ...f.followup, ...patch },
      0,
      later,
    );
    assert.equal(v.comparison.status, "unknown");
    assert.equal(v.comparison.delta, null);
  }
  const revised = {
    ...f.followup,
    revision: 2,
    cohortCollectedMinor: 75000,
    updatedAt: later.toISOString(),
  };
  const v = buildActionObservationView(
    f.observation,
    p,
    f.baseline,
    revised,
    0,
    later,
  );
  assert.equal(v.comparison.delta, -5);
  assert.equal(v.comparison.followupRevision, 2);
  assert.match(v.comparison.notes.join(" "), /corrections can change/);
});
test("implementation claims use predefined factors/CAS and cannot be future-dated starts", () => {
  const f = fixture();
  assert.throws(() =>
    parseActionConfounders(["none_reported", "other_actions"]),
  );
  assert.throws(() => parseActionConfounders(["unsure", "time_off"]));
  assert.throws(() => parseActionConfounders([]));
  code(
    () =>
      parseActionCheckIn(
        {
          revision: 0,
          implementation: "started_as_planned",
          confounders: ["none_reported"],
        },
        f.input.changeStartDate,
        now,
      ),
    "action_observation_not_started",
  );
  const check = parseActionCheckIn(
    {
      revision: 0,
      implementation: "started_late",
      confounders: ["pricing_changed", "other_actions"],
    },
    f.input.changeStartDate,
    later,
  );
  assert.equal(check.revision, 0);
  assert.deepEqual(check.confounders, ["other_actions", "pricing_changed"]);
});
test("concurrent registrations, owner scope and lack of counterfactual remain visible even for favorable values", () => {
  const f = fixture(),
    p = {
      ...f.plan,
      status: "reported" as const,
      outcomeId: f.followup.id,
      reportedAt: f.followup.createdAt,
    },
    v = buildActionObservationView(
      f.observation,
      p,
      f.baseline,
      f.followup,
      2,
      later,
    ),
    notes = v.comparison.notes.join(" ");
  assert.match(notes, /2 other action/);
  assert.match(notes, /without an untreated comparison/);
  assert.match(notes, /cannot establish that the action caused/);
  assert.match(notes, /not independent verification/);
  assert.match(notes, /not independently verified/);
  assert.match(notes, /not reported as starting as planned/);
  assert.equal(v.observation.implementation, "unreported");
});
