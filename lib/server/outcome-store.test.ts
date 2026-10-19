import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createOutcomeStore, OutcomeStorageError } from "./outcome-store";
import {
  OUTCOME_RESEARCH_TEXT,
  OUTCOME_RESEARCH_VERSION,
  parseOutcomePeriodInput,
} from "../outcomes";
import { POST, PATCH } from "../../app/api/account/outcomes/route";
import {
  DELETE,
  PATCH as updateRoute,
} from "../../app/api/account/outcomes/[id]/route";
const userId = "9780410c-1dc0-4b82-a272-b4e3add6a081",
  periodId = "5297ad82-c04a-40c2-92d9-9e4bbf4306e9";
const input = {
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
const period = {
  ...parseOutcomePeriodInput(input),
  id: periodId,
  revision: 0,
  createdAt: "2026-10-19T15:00:00Z",
  updatedAt: "2026-10-19T15:00:00Z",
};
test("create derives ownership only from verified caller and persists normalized aggregate fields", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const store = createOutcomeStore(async (name, args = {}) => {
    assert.equal(name, "grader_save_outcome");
    calls.push(args);
    return period;
  });
  assert.equal((await store.create(userId, input)).id, periodId);
  assert.equal(calls[0].p_user_id, userId);
  assert.equal(calls[0].p_id, null);
  assert.equal(calls[0].p_revision, 0);
  assert.deepEqual(calls[0].p_values, {
    inquiries: 100,
    contacted: 80,
    booked: 40,
    attended: 30,
    clients: 10,
    leadSpendMinor: 100000,
    cohortBilledMinor: 800000,
    cohortCollectedMinor: 600000,
    adminHours: 15.25,
  });
  await assert.rejects(
    store.create(userId, { ...input, ownerUserId: "forged" }),
  );
  assert.equal(calls.length, 1);
});
test("updates and deletion carry current revision; invalid bodies never reach storage", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const store = createOutcomeStore(async (name, args = {}) => {
    calls.push({ name, args });
    return name === "grader_delete_outcome" ? true : { ...period, revision: 1 };
  });
  await store.update(userId, periodId, { revision: 0, period: input });
  assert.equal(calls[0].args.p_revision, 0);
  await store.remove(userId, periodId, { revision: 1 });
  assert.equal(calls[1].args.p_revision, 1);
  for (const body of [
    { period: input },
    { revision: 0, period: input, owner: userId },
    { revision: -1, period: input },
  ])
    await assert.rejects(store.update(userId, periodId, body));
  await assert.rejects(
    store.remove(userId, periodId, { revision: 0, owner: userId }),
  );
  assert.equal(calls.length, 2);
});
test("overlap, ownership, baseline and revision failures have safe actionable messages", async () => {
  for (const [code, status] of [
    ["outcome_period_overlap", 409],
    ["not_found", 404],
    ["revision_conflict", 409],
    ["outcome_baseline_invalid", 409],
    ["outcome_period_limit", 429],
  ] as const) {
    const store = createOutcomeStore(async () => ({ error: code }));
    await assert.rejects(
      store.create(userId, input),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === code &&
        "status" in error &&
        error.status === status,
    );
  }
});
test("research consent passes exact purpose wording, independent version and CAS", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const store = createOutcomeStore(async (name, args = {}) => {
    assert.equal(name, "grader_set_outcome_research_consent");
    calls.push(args);
    return {
      granted: args.p_granted,
      revision: 1,
      version: OUTCOME_RESEARCH_VERSION,
      updatedAt: "2026-10-19T15:00:00Z",
    };
  });
  await store.setConsent(userId, {
    granted: true,
    revision: 0,
    consentVersion: OUTCOME_RESEARCH_VERSION,
  });
  assert.equal(calls[0].p_text, OUTCOME_RESEARCH_TEXT);
  assert.equal(calls[0].p_user_id, userId);
  assert.equal(calls[0].p_version, OUTCOME_RESEARCH_VERSION);
  await assert.rejects(
    store.setConsent(userId, {
      granted: true,
      revision: 0,
      consentVersion: "account-preferences-v1",
    }),
  );
  assert.equal(calls.length, 1);
});
test("read fails closed for malformed records or more than24 periods", async () => {
  const consent = {
    granted: false,
    revision: 0,
    version: OUTCOME_RESEARCH_VERSION,
    updatedAt: null,
  };
  assert.deepEqual(
    await createOutcomeStore(async () => ({ periods: [], consent })).read(
      userId,
    ),
    { periods: [], consent },
  );
  for (const periods of [
    Array.from({ length: 25 }, () => period),
    [period, period],
    [{ ...period, clients: 101 }],
  ])
    await assert.rejects(
      createOutcomeStore(async () => ({ periods, consent })).read(userId),
      OutcomeStorageError,
    );
});
test("private owner export cannot select another user through a request body", async () => {
  let args: Record<string, unknown> = {};
  const store = createOutcomeStore(async (name, value = {}) => {
    assert.equal(name, "grader_export_outcomes");
    args = value;
    return { periods: [], consentEvents: [], changes: [] };
  });
  await store.exportOwn(userId);
  assert.deepEqual(args, { p_user_id: userId });
});
test("all outcome mutation routes reject cross-origin writes before identity/data access", async () => {
  const request = () =>
    new Request("https://example.invalid/api/account/outcomes", {
      method: "POST",
      headers: {
        origin: "https://other.invalid",
        "content-type": "application/json",
      },
      body: "{}",
    });
  assert.equal((await POST(request())).status, 403);
  assert.equal((await PATCH(request())).status, 403);
  const context = { params: Promise.resolve({ id: periodId }) };
  assert.equal((await updateRoute(request(), context)).status, 403);
  assert.equal((await DELETE(request(), context)).status, 403);
});
