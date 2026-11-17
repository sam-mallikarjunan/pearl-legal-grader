import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AccountDataError } from "../account/validation";
import { PILOT_COHORT } from "../pilot-learning";
import {
  createPilotStore,
  decodePilotParticipation,
  decodePilotSummary,
  parsePilotFeedback,
  parsePilotJoin,
  parsePilotLeave,
} from "./pilot-store";

const owner = "523deb9b-0000-4000-8000-000000000001";
const joinedAt = "2026-11-17T15:28:14.661964+00:00";
const participation = {
  cohort: PILOT_COHORT,
  joinedAt,
  revision: 0,
  usefulness: null,
  blocker: null,
  firstUsefulAt: null,
  feedbackUpdatedAt: null,
};
const details = {
  reportsAvailable: 5,
  reportsSavedSinceJoining: 4,
  savedReportAndActionChosen: 4,
  newPlans: 3,
  eligibleTracking: 3,
  elapsedWindows: 2,
  exactFollowups: 1,
  comparableFollowups: 1,
  usefulnessResponses: 5,
  usefulResponses: 5,
  medianMinutesToUseful: 5,
  blockerResponses: 6,
  commonBlockers: { finding_baseline: 3, making_time: 3 },
  helpRequests: 1,
};
const summary = {
  cohort: PILOT_COHORT,
  capacity: 10,
  minimumForDetail: 5,
  enrolled: 6,
  details,
};
const fails = (code: string) => (err: unknown) =>
  err instanceof AccountDataError && err.code === code;

test("pilot enrollment requires true confirmation, fixed cohort, and no identifiers", () => {
  assert.deepEqual(parsePilotJoin({ cohort: PILOT_COHORT, confirm: true }), {
    cohort: PILOT_COHORT,
  });
  for (const payload of [
    { cohort: PILOT_COHORT, confirm: false },
    { cohort: "arbitrary-campaign", confirm: true },
    { cohort: PILOT_COHORT, confirm: true, accountId: owner },
    { cohort: PILOT_COHORT, confirm: "true" },
  ])
    assert.throws(() => parsePilotJoin(payload), fails("invalid_pilot_input"));
});

test("pilot feedback supports clearing but refuses free text, invalid revisions, and arbitrary dates", () => {
  const clean = { joinedAt, revision: 4, usefulness: null, blocker: null };
  assert.deepEqual(parsePilotFeedback(clean), clean);
  assert.deepEqual(parsePilotLeave({ joinedAt, confirm: true }), { joinedAt });
  for (const payload of [
    { ...clean, notes: "Private details" },
    { ...clean, blocker: "Free form" },
    { ...clean, usefulness: "__proto__" },
    { ...clean, revision: "4" },
    { ...clean, revision: -1 },
    { ...clean, joinedAt: "today" },
  ])
    assert.throws(
      () => parsePilotFeedback(payload),
      fails("invalid_pilot_input"),
    );
});

test("owner store maps known outcomes and cannot pass user-supplied identifiers to service methods", async () => {
  const calls: unknown[] = [];
  const store = createPilotStore(async (name, args) => {
    calls.push([name, args]);
    if (name === "grader_leave_pilot") return { participation: null };
    if (name === "grader_update_pilot_feedback")
      return { error: "pilot_changed", detail: "private echo" };
    return {
      participation: { ...participation, email: "private@example.invalid" },
    };
  });
  await assert.rejects(
    () =>
      store.join(owner, {
        cohort: PILOT_COHORT,
        confirm: true,
        p_user_id: "other",
      }),
    fails("invalid_pilot_input"),
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(
    await store.join(owner, { cohort: PILOT_COHORT, confirm: true }),
    participation,
  );
  assert.deepEqual(calls[0], [
    "grader_join_pilot",
    { p_user_id: owner, p_cohort: PILOT_COHORT },
  ]);
  await assert.rejects(
    () =>
      store.feedback(owner, {
        joinedAt,
        revision: 3,
        usefulness: "unsure",
        blocker: null,
      }),
    (error: unknown) =>
      fails("pilot_changed")(error) && !String(error).includes("private echo"),
  );
  assert.equal(await store.leave(owner, { joinedAt, confirm: true }), null);
});

test("private owner export response allows only the minimal enrollment and feedback fields", () => {
  assert.equal(decodePilotParticipation({ participation: null }), null);
  assert.deepEqual(
    decodePilotParticipation({
      participation: {
        ...participation,
        workspace_id: owner,
        recipient: "private",
        report: {},
      },
    }),
    participation,
  );
  assert.throws(
    () =>
      decodePilotParticipation({
        participation: {
          ...participation,
          usefulness: "useful",
          firstUsefulAt: null,
        },
      }),
    fails("pilot_unavailable"),
  );
});

test("operator summary withholds small cohorts and validates nested denominators", () => {
  const small = { ...summary, enrolled: 1, details: null };
  assert.deepEqual(decodePilotSummary(small), small);
  assert.throws(
    () => decodePilotSummary({ ...small, details }),
    fails("pilot_unavailable"),
  );
  assert.deepEqual(decodePilotSummary(summary), summary);
  for (const inconsistent of [
    { ...details, comparableFollowups: 2 },
    { ...details, elapsedWindows: 4 },
    { ...details, usefulResponses: 3, medianMinutesToUseful: 5 },
    { ...details, commonBlockers: { finding_action: 1 } },
    { ...details, commonBlockers: { finding_action: 4 } },
    { ...details, commonBlockers: { recipient: 3 } },
  ])
    assert.throws(
      () => decodePilotSummary({ ...summary, details: inconsistent }),
      fails("pilot_unavailable"),
    );
});

test("operator summary projects approved data only, with no raw outcomes or hidden owner fields", () => {
  const tainted = {
    ...summary,
    owners: [owner],
    details: {
      ...details,
      rawRows: [{ email: "private@example.invalid", clients: 12 }],
      reportIDs: [owner],
    },
  };
  assert.deepEqual(decodePilotSummary(tainted), summary);
});
