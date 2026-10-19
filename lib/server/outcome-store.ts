import { accountRpc } from "./account-db";
import { accountRecord, accountUuid } from "../account/validation";
import {
  OUTCOME_COUNT_FIELDS,
  OUTCOME_MONEY_FIELDS,
  OUTCOME_RESEARCH_TEXT,
  OUTCOME_RESEARCH_VERSION,
  OUTCOME_LIMITS,
  OutcomeInputError,
  parseOutcomeConsent,
  parseOutcomePeriodInput,
  parseOutcomeRevision,
  type OutcomeAccountState,
  type OutcomePeriod,
  type OutcomePeriodInput,
  type OutcomeResearchConsent,
} from "../outcomes";
if (typeof window !== "undefined")
  throw new Error("Private outcome data must run on the server.");
export class OutcomeStorageError extends Error {
  readonly code = "outcomes_unavailable";
  readonly status = 503;
  constructor() {
    super(
      "Your private business periods are temporarily unavailable. Please try again.",
    );
    this.name = "OutcomeStorageError";
  }
}
const stamp = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
function decodePeriod(value: unknown): OutcomePeriod {
  if (
    !accountRecord(value) ||
    !accountUuid(value.id) ||
    !stamp(value.createdAt) ||
    !stamp(value.updatedAt)
  )
    throw new OutcomeStorageError();
  let input: OutcomePeriodInput, revision: number;
  try {
    const {
      id: _id,
      revision: r,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...body
    } = value;
    input = parseOutcomePeriodInput(body);
    revision = parseOutcomeRevision(r);
  } catch {
    throw new OutcomeStorageError();
  }
  return {
    ...input,
    id: value.id,
    revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
function decodeConsent(value: unknown): OutcomeResearchConsent {
  if (
    !accountRecord(value) ||
    typeof value.granted !== "boolean" ||
    value.version !== OUTCOME_RESEARCH_VERSION ||
    !(value.updatedAt === null || stamp(value.updatedAt))
  )
    throw new OutcomeStorageError();
  let revision: number;
  try {
    revision = parseOutcomeRevision(value.revision);
  } catch {
    throw new OutcomeStorageError();
  }
  return {
    granted: value.granted,
    revision,
    version: OUTCOME_RESEARCH_VERSION,
    updatedAt: value.updatedAt,
  };
}
function machineError(value: unknown) {
  if (!accountRecord(value) || typeof value.error !== "string") return;
  const errors: Record<string, [string, number]> = {
    not_found: ["This business period is unavailable in your account.", 404],
    revision_conflict: [
      "This period or permission changed elsewhere. Reload before saving.",
      409,
    ],
    outcome_period_overlap: [
      "This period overlaps one already saved. Edit that period or choose a separate date range.",
      409,
    ],
    outcome_period_limit: [
      "You can save up to 24 business periods. Delete an old period before adding another.",
      429,
    ],
    outcome_change_limit: [
      "This account has reached its period-change allowance. Export and deletion remain available.",
      429,
    ],
    outcome_consent_limit: [
      "This account has reached its research opt-in change allowance. Withdrawal remains available.",
      429,
    ],
    outcome_plan_frozen: [
      "This planned period has frozen dates, source, currency and baseline. Only its numbers can change.",
      409,
    ],
    outcome_plan_overlap: [
      "This period overlaps a registered plan. Use that plan to report its results, or choose a separate period.",
      409,
    ],
    outcome_baseline_invalid: [
      "Choose an owned saved report assessed and saved before this period started, or leave the period unlinked.",
      409,
    ],
  };
  const error = errors[value.error];
  if (error) throw new OutcomeInputError(value.error, error[0], error[1]);
  throw new OutcomeStorageError();
}
function owner(id: string) {
  if (!accountUuid(id))
    throw new OutcomeInputError(
      "invalid_account",
      "Sign in to view your private business periods.",
      401,
    );
}
function periodArgs(input: OutcomePeriodInput) {
  const values: Record<string, number | null> = {};
  for (const field of [
    ...OUTCOME_COUNT_FIELDS,
    ...OUTCOME_MONEY_FIELDS,
    "adminHours" as const,
  ])
    values[field] = input[field];
  return {
    p_start: input.startDate,
    p_end: input.endDate,
    p_source: input.source,
    p_currency: input.currency,
    p_baseline: input.baselineReportId,
    p_values: values,
  };
}
export function createOutcomeStore(rpcCall: typeof accountRpc) {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const value = await rpcCall(name, args);
    machineError(value);
    return value;
  };
  return {
    async read(userId: string): Promise<OutcomeAccountState> {
      owner(userId);
      const value = await rpc("grader_read_outcomes", { p_user_id: userId });
      if (
        !accountRecord(value) ||
        !Array.isArray(value.periods) ||
        value.periods.length > OUTCOME_LIMITS.periods
      )
        throw new OutcomeStorageError();
      const periods = value.periods.map(decodePeriod);
      if (new Set(periods.map((p) => p.id)).size !== periods.length)
        throw new OutcomeStorageError();
      return { periods, consent: decodeConsent(value.consent) };
    },
    async create(userId: string, body: unknown): Promise<OutcomePeriod> {
      owner(userId);
      const input = parseOutcomePeriodInput(body);
      return decodePeriod(
        await rpc("grader_save_outcome", {
          p_user_id: userId,
          p_id: null,
          p_revision: 0,
          ...periodArgs(input),
        }),
      );
    },
    async update(
      userId: string,
      id: string,
      body: unknown,
    ): Promise<OutcomePeriod> {
      owner(userId);
      if (
        !accountUuid(id) ||
        !accountRecord(body) ||
        Object.keys(body).length !== 2 ||
        !("revision" in body) ||
        !("period" in body)
      )
        throw new OutcomeInputError(
          "invalid_outcome",
          "Choose your saved period and current revision.",
        );
      const revision = parseOutcomeRevision(body.revision),
        input = parseOutcomePeriodInput(body.period);
      return decodePeriod(
        await rpc("grader_save_outcome", {
          p_user_id: userId,
          p_id: id,
          p_revision: revision,
          ...periodArgs(input),
        }),
      );
    },
    async remove(userId: string, id: string, body: unknown): Promise<void> {
      owner(userId);
      if (
        !accountUuid(id) ||
        !accountRecord(body) ||
        Object.keys(body).length !== 1 ||
        !("revision" in body)
      )
        throw new OutcomeInputError(
          "invalid_outcome",
          "Choose your saved period and current revision.",
        );
      const result = await rpc("grader_delete_outcome", {
        p_user_id: userId,
        p_id: id,
        p_revision: parseOutcomeRevision(body.revision),
      });
      if (result !== true) throw new OutcomeStorageError();
    },
    async setConsent(
      userId: string,
      body: unknown,
    ): Promise<OutcomeResearchConsent> {
      owner(userId);
      const input = parseOutcomeConsent(body);
      return decodeConsent(
        await rpc("grader_set_outcome_research_consent", {
          p_user_id: userId,
          p_revision: input.revision,
          p_granted: input.granted,
          p_version: OUTCOME_RESEARCH_VERSION,
          p_text: OUTCOME_RESEARCH_TEXT,
        }),
      );
    },
    async exportOwn(userId: string): Promise<unknown> {
      owner(userId);
      return rpc("grader_export_outcomes", { p_user_id: userId });
    },
  };
}
const store = () => createOutcomeStore(accountRpc);
export const readOwnOutcomes = (id: string) => store().read(id);
export const createOwnOutcome = (id: string, body: unknown) =>
  store().create(id, body);
export const updateOwnOutcome = (userId: string, id: string, body: unknown) =>
  store().update(userId, id, body);
export const deleteOwnOutcome = (userId: string, id: string, body: unknown) =>
  store().remove(userId, id, body);
export const setOwnOutcomeResearchConsent = (id: string, body: unknown) =>
  store().setConsent(id, body);
export const exportOwnOutcomes = (id: string) => store().exportOwn(id);
