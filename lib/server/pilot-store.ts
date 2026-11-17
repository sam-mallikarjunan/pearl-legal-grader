import {
  AccountDataError,
  accountRecord,
  accountUuid,
} from "../account/validation";
import {
  PILOT_BLOCKERS,
  PILOT_CAPACITY,
  PILOT_COHORT,
  PILOT_MINIMUM_DETAIL,
  PILOT_USEFULNESS,
  type PilotBlocker,
  type PilotParticipation,
  type PilotSummary,
  type PilotUsefulness,
} from "../pilot-learning";
import { accountRpc } from "./account-db";

if (typeof window !== "undefined")
  throw new Error("Pilot storage is server-only.");

const unavailable = () =>
  new AccountDataError(
    "pilot_unavailable",
    "The pilot could not load. Try again shortly.",
    503,
  );
const invalid = () =>
  new AccountDataError(
    "invalid_pilot_input",
    "Review your pilot choices and try again.",
  );
const changed = () =>
  new AccountDataError(
    "pilot_changed",
    "Your pilot record changed. Refresh before continuing.",
    409,
  );
const full = () =>
  new AccountDataError(
    "pilot_capacity",
    "The pilot is currently full. You can still use the grader.",
    409,
  );

function requiredOwner(id: string) {
  if (!accountUuid(id)) throw invalid();
  return id;
}

function shape(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    accountRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function usefulness(value: unknown): value is PilotUsefulness | null {
  return (
    value === null ||
    (typeof value === "string" && Object.hasOwn(PILOT_USEFULNESS, value))
  );
}

function blocker(value: unknown): value is PilotBlocker | null {
  return (
    value === null ||
    (typeof value === "string" && Object.hasOwn(PILOT_BLOCKERS, value))
  );
}

function revision(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= 1_000_000
  );
}

export function parsePilotJoin(value: unknown) {
  if (
    !shape(value, ["cohort", "confirm"]) ||
    value.cohort !== PILOT_COHORT ||
    value.confirm !== true
  )
    throw invalid();
  return { cohort: PILOT_COHORT };
}

export function parsePilotFeedback(value: unknown) {
  if (
    !shape(value, ["joinedAt", "revision", "usefulness", "blocker"]) ||
    !timestamp(value.joinedAt) ||
    !revision(value.revision) ||
    !usefulness(value.usefulness) ||
    !blocker(value.blocker)
  )
    throw invalid();
  return {
    joinedAt: value.joinedAt,
    revision: value.revision,
    usefulness: value.usefulness,
    blocker: value.blocker,
  };
}

export function parsePilotLeave(value: unknown) {
  if (
    !shape(value, ["joinedAt", "confirm"]) ||
    !timestamp(value.joinedAt) ||
    value.confirm !== true
  )
    throw invalid();
  return { joinedAt: value.joinedAt };
}

function rpcError(value: unknown) {
  if (!accountRecord(value)) throw unavailable();
  if (!Object.hasOwn(value, "error")) return;
  if (value.error === "pilot_changed") throw changed();
  if (value.error === "pilot_capacity") throw full();
  if (
    value.error === "invalid_pilot_cohort" ||
    value.error === "invalid_pilot_feedback"
  )
    throw invalid();
  throw unavailable();
}

export function decodePilotParticipation(
  value: unknown,
): PilotParticipation | null {
  rpcError(value);
  if (!accountRecord(value)) throw unavailable();
  const row = value.participation;
  if (row === null) return null;
  if (
    !accountRecord(row) ||
    row.cohort !== PILOT_COHORT ||
    !timestamp(row.joinedAt) ||
    !revision(row.revision) ||
    !usefulness(row.usefulness) ||
    !blocker(row.blocker) ||
    (row.firstUsefulAt !== null && !timestamp(row.firstUsefulAt)) ||
    (row.feedbackUpdatedAt !== null && !timestamp(row.feedbackUpdatedAt)) ||
    (row.usefulness === "useful") !== (row.firstUsefulAt !== null) ||
    (row.usefulness !== null || row.blocker !== null) !==
      (row.feedbackUpdatedAt !== null) ||
    (row.firstUsefulAt !== null &&
      Date.parse(row.firstUsefulAt) < Date.parse(row.joinedAt)) ||
    (row.feedbackUpdatedAt !== null &&
      Date.parse(row.feedbackUpdatedAt) < Date.parse(row.joinedAt))
  )
    throw unavailable();
  // Return only the reviewed owner-visible fields, even if the backing RPC changes.
  return {
    cohort: PILOT_COHORT,
    joinedAt: row.joinedAt,
    revision: row.revision,
    usefulness: row.usefulness,
    blocker: row.blocker,
    firstUsefulAt: row.firstUsefulAt,
    feedbackUpdatedAt: row.feedbackUpdatedAt,
  };
}

export function decodePilotSummary(value: unknown): PilotSummary {
  rpcError(value);
  if (
    !accountRecord(value) ||
    value.cohort !== PILOT_COHORT ||
    value.capacity !== PILOT_CAPACITY ||
    value.minimumForDetail !== PILOT_MINIMUM_DETAIL ||
    !Number.isSafeInteger(value.enrolled) ||
    Number(value.enrolled) < 0 ||
    Number(value.enrolled) > PILOT_CAPACITY
  )
    throw unavailable();
  const enrolled = Number(value.enrolled);
  const base = {
    cohort: PILOT_COHORT,
    capacity: PILOT_CAPACITY,
    minimumForDetail: PILOT_MINIMUM_DETAIL,
    enrolled,
  } as const;
  // Double-check that the DB withheld detail. Do not ignore a contradictory response.
  if (enrolled < PILOT_MINIMUM_DETAIL) {
    if (value.details !== null) throw unavailable();
    return { ...base, details: null };
  }
  const d = value.details;
  if (!accountRecord(d) || !accountRecord(d.commonBlockers))
    throw unavailable();
  const count = (key: string, max = enrolled) => {
    const n = d[key];
    if (!Number.isSafeInteger(n) || Number(n) < 0 || Number(n) > max)
      throw unavailable();
    return Number(n);
  };
  const reportsAvailable = count("reportsAvailable");
  const eligibleTracking = count("eligibleTracking", reportsAvailable);
  const elapsedWindows = count("elapsedWindows", eligibleTracking);
  const exactFollowups = count("exactFollowups", elapsedWindows);
  const usefulnessResponses = count("usefulnessResponses");
  const usefulResponses = count("usefulResponses", usefulnessResponses);
  const blockerResponses = count("blockerResponses");
  const median = d.medianMinutesToUseful;
  if (
    median !== null &&
    (usefulResponses < 5 ||
      !Number.isSafeInteger(median) ||
      Number(median) < 0 ||
      Number(median) % 5 !== 0)
  )
    throw unavailable();
  const commonBlockers: Partial<Record<PilotBlocker, number>> = {};
  let shownBlockers = 0;
  for (const [key, n] of Object.entries(d.commonBlockers)) {
    if (
      !blocker(key) ||
      !Number.isSafeInteger(n) ||
      Number(n) < 3 ||
      blockerResponses - Number(n) < 3
    )
      throw unavailable();
    commonBlockers[key] = Number(n);
    shownBlockers += Number(n);
  }
  if (shownBlockers > blockerResponses) throw unavailable();
  return {
    ...base,
    details: {
      reportsAvailable,
      reportsSavedSinceJoining: count(
        "reportsSavedSinceJoining",
        reportsAvailable,
      ),
      savedReportAndActionChosen: count(
        "savedReportAndActionChosen",
        reportsAvailable,
      ),
      newPlans: count("newPlans", reportsAvailable),
      eligibleTracking,
      elapsedWindows,
      exactFollowups,
      comparableFollowups: count("comparableFollowups", exactFollowups),
      usefulnessResponses,
      usefulResponses,
      medianMinutesToUseful: median === null ? null : Number(median),
      blockerResponses,
      commonBlockers,
      helpRequests: count("helpRequests"),
    },
  };
}

export function createPilotStore(rpc: typeof accountRpc = accountRpc) {
  return {
    async participation(userId: string) {
      return decodePilotParticipation(
        await rpc("grader_read_pilot", { p_user_id: requiredOwner(userId) }),
      );
    },
    async join(userId: string, input: unknown) {
      const { cohort } = parsePilotJoin(input);
      const row = decodePilotParticipation(
        await rpc("grader_join_pilot", {
          p_user_id: requiredOwner(userId),
          p_cohort: cohort,
        }),
      );
      if (!row) throw unavailable();
      return row;
    },
    async feedback(userId: string, input: unknown) {
      const { joinedAt, revision, usefulness, blocker } =
        parsePilotFeedback(input);
      const row = decodePilotParticipation(
        await rpc("grader_update_pilot_feedback", {
          p_user_id: requiredOwner(userId),
          p_joined_at: joinedAt,
          p_revision: revision,
          p_usefulness: usefulness,
          p_blocker: blocker,
        }),
      );
      if (!row) throw unavailable();
      return row;
    },
    async leave(userId: string, input: unknown) {
      const { joinedAt } = parsePilotLeave(input);
      const row = decodePilotParticipation(
        await rpc("grader_leave_pilot", {
          p_user_id: requiredOwner(userId),
          p_joined_at: joinedAt,
        }),
      );
      if (row) throw unavailable();
      return null;
    },
    async summary() {
      return decodePilotSummary(await rpc("grader_read_pilot_summary"));
    },
  };
}

export function exportOwnPilotParticipation(userId: string) {
  return createPilotStore().participation(userId);
}
