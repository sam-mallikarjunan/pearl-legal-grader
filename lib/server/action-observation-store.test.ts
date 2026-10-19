import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createActionObservationStore,
  ActionObservationStorageError,
} from "./action-observation-store";
import {
  actionObservationFixtures as fixture,
  actionObservationNow as now,
  actionObservationUser as user,
} from "../action-observation-test-fixtures";
import { ACTION_OBSERVATION_VERSION } from "../action-observations";
const empty = () => ({
  observations: [],
  plans: [],
  baselines: [],
  followups: [],
});
function deps(
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  const f = fixture();
  return {
    rpc: (name: string, args: Record<string, unknown> = {}) => rpc(name, args),
    readReport: async () => f.report,
    readPlans: async () => ({ plans: [f.plan] }),
    readOutcomes: async () => ({
      periods: [f.baseline],
      consent: {
        granted: false,
        revision: 0,
        version: "outcome-research-consent-v1" as const,
        updatedAt: null,
      },
    }),
    now: () => now,
  };
}
test("registration passes server-derived ownership and fixed CAS lineage, never a client owner or raw report", async () => {
  const f = fixture(),
    calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const store = createActionObservationStore(
    deps(async (name, args) => {
      calls.push({ name, args });
      return name === "grader_read_action_observations"
        ? empty()
        : f.observation;
    }),
  );
  const result = await store.register(user, f.input);
  assert.equal(result.id, f.observation.id);
  const c = calls.find((c) => c.name === "grader_register_action_observation")!;
  assert.equal(c.args.p_user_id, user);
  assert.match(c.args.p_hash as string, /^[a-f0-9]{64}$/);
  assert.deepEqual(c.args.p_input, f.input);
  assert.ok(!JSON.stringify(c.args).includes("answersSnapshot"));
  await assert.rejects(
    store.register(user, { ...f.input, ownerUserId: f.report.id }),
  );
});
test("same-request replay after window start returns original registration without reads/writes or new quota", async () => {
  const f = fixture();
  let writes = 0;
  const store = createActionObservationStore({
    ...deps(async (name) => {
      if (name !== "grader_read_action_observations") writes++;
      return {
        observations: [f.observation],
        plans: [f.plan],
        baselines: [f.baseline],
        followups: [],
      };
    }),
    now: () => new Date("2026-12-02T12:00:00Z"),
    readPlans: async () => {
      throw new Error("must not read");
    },
  });
  assert.equal((await store.register(user, f.input)).id, f.observation.id);
  assert.equal(writes, 0);
  await assert.rejects(
    store.register(user, { ...f.input, metricId: "cost_per_client" }),
    (e: unknown) =>
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      e.code === "action_observation_request_conflict",
  );
});
test("a baseline or plan revision race at the atomic write becomes409, never a local success", async () => {
  const f = fixture();
  const store = createActionObservationStore(
    deps(async (name) =>
      name === "grader_read_action_observations"
        ? empty()
        : { error: "revision_conflict" },
    ),
  );
  await assert.rejects(
    store.register(user, f.input),
    (e: unknown) =>
      typeof e === "object" && e !== null && "status" in e && e.status === 409,
  );
});
test("private read calculates only its locked plan result and counts even withdrawn concurrent registrations", async () => {
  const f = fixture(),
    other = {
      ...f.observation,
      id: f.baseline.id,
      requestId: f.report.id,
      status: "withdrawn" as const,
      withdrawnAt: now.toISOString(),
      action: { ...f.observation.action, id: "other-action" },
    };
  const store = createActionObservationStore(
    deps(async () => ({
      observations: [f.observation, other],
      plans: [f.plan],
      baselines: [f.baseline],
      followups: [],
    })),
  );
  const data = await store.read(user);
  assert.equal(data.views[0].comparison.status, "waiting");
  assert.equal(data.views[0].comparison.concurrentRegistrations, 1);
  assert.ok(!("baselines" in data));
  assert.ok(!("plans" in data));
  assert.equal(data.version, ACTION_OBSERVATION_VERSION);
});
test("check-ins and terminal withdrawal send exact owner and revision and sanitize provider/database failures", async () => {
  const f = fixture(),
    calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const store = createActionObservationStore(
    deps(async (name, args) => {
      calls.push({ name, args });
      if (name === "grader_read_action_observations")
        return {
          observations: [f.observation],
          plans: [f.plan],
          baselines: [f.baseline],
          followups: [],
        };
      if (name === "grader_check_in_action_observation")
        return {
          ...f.observation,
          revision: 1,
          implementation: "not_started",
          implementationRecordedAt: now.toISOString(),
        };
      return {
        ...f.observation,
        status: "withdrawn",
        revision: 2,
        withdrawnAt: now.toISOString(),
      };
    }),
  );
  await store.checkIn(user, f.observation.id, {
    revision: 0,
    implementation: "not_started",
    confounders: ["unsure"],
  });
  await store.withdraw(user, f.observation.id, { revision: 1 });
  assert.deepEqual(
    calls.find((c) => c.name === "grader_check_in_action_observation")!.args,
    {
      p_user_id: user,
      p_id: f.observation.id,
      p_revision: 0,
      p_implementation: "not_started",
      p_confounders: ["unsure"],
    },
  );
  assert.equal(
    calls.find((c) => c.name === "grader_withdraw_action_observation")!.args
      .p_revision,
    1,
  );
  const broken = createActionObservationStore(
    deps(async () => {
      throw new Error("secret credentials");
    }),
  );
  await assert.rejects(
    broken.read(user),
    (e: unknown) =>
      e instanceof ActionObservationStorageError &&
      !e.message.includes("secret"),
  );
});
test("owner export projects safe frozen observations and enum audits, discarding unexpected raw fields", async () => {
  const f = fixture();
  const store = createActionObservationStore(
    deps(async (_name, args) => {
      assert.equal(args.p_user_id, user);
      return {
        version: ACTION_OBSERVATION_VERSION,
        observations: [{ ...f.observation, requestHash: "PRIVATE" }],
        events: [
          {
            observationId: f.observation.id,
            action: "registered",
            revision: 0,
            implementation: "unreported",
            confounders: ["unsure"],
            recordedAt: now.toISOString(),
            rawAnswers: "PRIVATE",
          },
        ],
        rawCsv: "PRIVATE",
      };
    }),
  );
  const data = await store.exportOwn(user);
  assert.ok(!JSON.stringify(data).includes("PRIVATE"));
  assert.equal(data.events.length, 1);
  assert.equal(data.observations.length, 1);
  await assert.rejects(store.read("not-a-user"));
});
