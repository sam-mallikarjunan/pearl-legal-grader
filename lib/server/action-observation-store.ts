import { createHash } from "node:crypto";
import { accountRpc } from "./account-db";
import { readAccountReport } from "./account-store";
import { readOwnOutcomes } from "./outcome-store";
import { readOwnOutcomePlans } from "./outcome-plan-store";
import {
  accountRecord,
  accountUuid,
  canonicalJson,
} from "../account/validation";
import {
  OutcomeInputError,
  parseOutcomePeriodInput,
  parseOutcomeRevision,
  type OutcomePeriod,
} from "../outcomes";
import { decodeOutcomePlan } from "../outcome-plans";
import {
  ACTION_OBSERVATION_LIMIT,
  ACTION_OBSERVATION_VERSION,
  ACTION_IMPLEMENTATIONS,
  actionObservationInputMatches,
  buildActionObservationView,
  decodeActionObservation,
  parseActionCheckIn,
  parseActionConfounders,
  parseActionObservationInput,
  parseActionWithdrawal,
  validateActionObservationRegistration,
} from "../action-observations";
if (typeof window !== "undefined")
  throw new Error("Private action observations are server-only.");
export class ActionObservationStorageError extends Error {
  readonly code = "action_observations_unavailable";
  readonly status = 503;
  constructor() {
    super(
      "Your private action tracking is temporarily unavailable. Refresh before saving again.",
    );
  }
}
const errors: Record<string, [string, number]> = {
  not_found: [
    "This tracking record, plan or period is unavailable in your account.",
    404,
  ],
  revision_conflict: [
    "The tracking record, plan or baseline changed elsewhere. Refresh and review it before saving.",
    409,
  ],
  invalid_action_observation: [
    "Choose a valid issued action, future plan and reviewed baseline.",
    400,
  ],
  action_observation_request_conflict: [
    "This registration request already has different details. Review it as a new request.",
    409,
  ],
  action_observation_not_prospective: [
    "Register before the change date and the start of a future calendar month.",
    409,
  ],
  action_observation_action_invalid: [
    "Choose an action issued in this plan’s owned canonical baseline report.",
    409,
  ],
  action_observation_baseline_invalid: [
    "Choose a closed baseline month with matching practice scope, source and currency.",
    409,
  ],
  action_observation_scope_required: [
    "Separately confirm that the unlinked baseline describes this practice.",
    409,
  ],
  action_observation_baseline_unknown: [
    "The chosen baseline measure needs known values and a positive denominator.",
    409,
  ],
  action_observation_limit: [
    "This account has reached its 72-registration preview allowance. Existing tracking, withdrawal and export remain available.",
    429,
  ],
  action_observation_plan_limit: [
    "Use at most three registrations per plan, with one fixed measure per issued action.",
    429,
  ],
  action_observation_change_limit: [
    "The check-in allowance is full. Withdrawal and export remain available.",
    429,
  ],
  action_observation_withdrawn: [
    "This tracking registration was withdrawn and cannot be reopened.",
    409,
  ],
  action_observation_not_started: [
    "Record a start claim on or after the planned change date.",
    409,
  ],
};
const owner = (id: string) => {
  if (!accountUuid(id))
    throw new OutcomeInputError(
      "invalid_account",
      "Sign in to manage your private action tracking.",
      401,
    );
};
const stamp = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
function period(v: unknown, now: Date): OutcomePeriod {
  if (
    !accountRecord(v) ||
    !accountUuid(v.id) ||
    !stamp(v.createdAt) ||
    !stamp(v.updatedAt)
  )
    throw new ActionObservationStorageError();
  const { id, revision, createdAt, updatedAt, ...input } = v;
  return {
    ...parseOutcomePeriodInput(input, now),
    id,
    revision: parseOutcomeRevision(revision),
    createdAt,
    updatedAt,
  };
}
export function createActionObservationStore(d: {
  rpc: typeof accountRpc;
  readReport: typeof readAccountReport;
  readOutcomes: typeof readOwnOutcomes;
  readPlans: typeof readOwnOutcomePlans;
  now?: () => Date;
}) {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    try {
      const v = await d.rpc(name, args);
      if (accountRecord(v) && typeof v.error === "string") {
        const e = errors[v.error];
        if (e) throw new OutcomeInputError(v.error, e[0], e[1]);
        throw new ActionObservationStorageError();
      }
      return v;
    } catch (e) {
      if (
        e instanceof OutcomeInputError ||
        e instanceof ActionObservationStorageError
      )
        throw e;
      if (accountRecord(e) && typeof e.code === "string" && errors[e.code])
        throw new OutcomeInputError(
          e.code,
          errors[e.code][0],
          errors[e.code][1],
        );
      throw new ActionObservationStorageError();
    }
  };
  const readRaw = async (userId: string) => {
    owner(userId);
    const v = await rpc("grader_read_action_observations", {
      p_user_id: userId,
    });
    try {
      if (
        !accountRecord(v) ||
        !Array.isArray(v.observations) ||
        v.observations.length > ACTION_OBSERVATION_LIMIT ||
        !Array.isArray(v.plans) ||
        v.plans.length > 36 ||
        !Array.isArray(v.baselines) ||
        v.baselines.length > 24 ||
        !Array.isArray(v.followups) ||
        v.followups.length > 24
      )
        throw new ActionObservationStorageError();
      const observations = v.observations.map(decodeActionObservation),
        plans = v.plans.map(decodeOutcomePlan),
        baselines = v.baselines.map((v) => period(v, d.now?.() ?? new Date())),
        followups = v.followups.map((v) => period(v, d.now?.() ?? new Date()));
      for (const rows of [observations, plans, baselines, followups])
        if (new Set(rows.map((r) => r.id)).size !== rows.length)
          throw new ActionObservationStorageError();
      if (
        new Set(observations.map((o) => o.requestId)).size !==
        observations.length
      )
        throw new ActionObservationStorageError();
      return { observations, plans, baselines, followups };
    } catch {
      throw new ActionObservationStorageError();
    }
  };
  const read = async (userId: string) => {
    const v = await readRaw(userId);
    return {
      version: ACTION_OBSERVATION_VERSION,
      limit: ACTION_OBSERVATION_LIMIT,
      views: v.observations.map((o) => {
        const plan = v.plans.find((p) => p.id === o.planId) ?? null;
        return buildActionObservationView(
          o,
          plan,
          v.baselines.find((p) => p.id === o.baseline.id) ?? null,
          plan
            ? (v.followups.find((p) => p.id === plan.outcomeId) ?? null)
            : null,
          v.observations.filter((a) => a.planId === o.planId && a.id !== o.id)
            .length,
          d.now?.(),
        );
      }),
    };
  };
  return {
    read,
    async register(userId: string, body: unknown) {
      owner(userId);
      const input = parseActionObservationInput(body);
      const old = (await readRaw(userId)).observations.find(
        (o) => o.requestId === input.requestId,
      );
      if (old) {
        if (!actionObservationInputMatches(old, input))
          throw new OutcomeInputError(
            "action_observation_request_conflict",
            errors.action_observation_request_conflict[0],
            409,
          );
        return old;
      }
      const [planned, measured] = await Promise.all([
        d.readPlans(userId),
        d.readOutcomes(userId),
      ]);
      const plan = planned.plans.find((p) => p.id === input.planId),
        baseline = measured.periods.find(
          (p) => p.id === input.baselinePeriodId,
        );
      if (!plan || !baseline || !plan.baselineReportId)
        throw new OutcomeInputError("not_found", errors.not_found[0], 404);
      const report = await d.readReport(userId, plan.baselineReportId);
      const baselineReport =
        baseline.baselineReportId === report.id
          ? report
          : baseline.baselineReportId
            ? await d.readReport(userId, baseline.baselineReportId)
            : null;
      validateActionObservationRegistration(
        input,
        plan,
        report,
        baseline,
        baselineReport,
        d.now?.(),
      );
      return decodeActionObservation(
        await rpc("grader_register_action_observation", {
          p_user_id: userId,
          p_hash: createHash("sha256")
            .update(canonicalJson(input))
            .digest("hex"),
          p_input: input,
        }),
      );
    },
    async checkIn(userId: string, id: string, body: unknown) {
      owner(userId);
      if (!accountUuid(id))
        throw new OutcomeInputError("not_found", errors.not_found[0], 404);
      const o = (await readRaw(userId)).observations.find((o) => o.id === id);
      if (!o)
        throw new OutcomeInputError("not_found", errors.not_found[0], 404);
      const input = parseActionCheckIn(body, o.changeStartDate, d.now?.());
      return decodeActionObservation(
        await rpc("grader_check_in_action_observation", {
          p_user_id: userId,
          p_id: id,
          p_revision: input.revision,
          p_implementation: input.implementation,
          p_confounders: input.confounders,
        }),
      );
    },
    async withdraw(userId: string, id: string, body: unknown) {
      owner(userId);
      if (!accountUuid(id))
        throw new OutcomeInputError("not_found", errors.not_found[0], 404);
      return decodeActionObservation(
        await rpc("grader_withdraw_action_observation", {
          p_user_id: userId,
          p_id: id,
          p_revision: parseActionWithdrawal(body),
        }),
      );
    },
    async exportOwn(userId: string) {
      owner(userId);
      const v = await rpc("grader_export_action_observations", {
        p_user_id: userId,
      });
      try {
        if (
          !accountRecord(v) ||
          v.version !== ACTION_OBSERVATION_VERSION ||
          !Array.isArray(v.observations) ||
          v.observations.length > ACTION_OBSERVATION_LIMIT ||
          !Array.isArray(v.events) ||
          v.events.length > 2072
        )
          throw new ActionObservationStorageError();
        const observations = v.observations.map(decodeActionObservation);
        const events = v.events.map((e) => {
          if (
            !accountRecord(e) ||
            !accountUuid(e.observationId) ||
            !["registered", "check_in", "withdrawn"].includes(
              String(e.action),
            ) ||
            !ACTION_IMPLEMENTATIONS.includes(e.implementation as never) ||
            !stamp(e.recordedAt)
          )
            throw new ActionObservationStorageError();
          return {
            observationId: e.observationId,
            action: e.action,
            revision: parseOutcomeRevision(e.revision),
            implementation: e.implementation,
            confounders: parseActionConfounders(e.confounders),
            recordedAt: e.recordedAt,
          };
        });
        return { version: ACTION_OBSERVATION_VERSION, observations, events };
      } catch {
        throw new ActionObservationStorageError();
      }
    },
  };
}
const configured = () =>
  createActionObservationStore({
    rpc: accountRpc,
    readReport: readAccountReport,
    readOutcomes: readOwnOutcomes,
    readPlans: readOwnOutcomePlans,
  });
export const readOwnActionObservations = (userId: string) =>
  configured().read(userId);
export const registerOwnActionObservation = (userId: string, body: unknown) =>
  configured().register(userId, body);
export const checkInOwnActionObservation = (
  userId: string,
  id: string,
  body: unknown,
) => configured().checkIn(userId, id, body);
export const withdrawOwnActionObservation = (
  userId: string,
  id: string,
  body: unknown,
) => configured().withdraw(userId, id, body);
export const exportOwnActionObservations = (userId: string) =>
  configured().exportOwn(userId);
