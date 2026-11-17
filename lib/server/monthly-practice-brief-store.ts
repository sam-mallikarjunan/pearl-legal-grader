import {
  AccountDataError,
  accountRecord,
  accountUuid,
} from "../account/validation";
import {
  buildMonthlyPracticeBriefs,
  decodeMonthlyBriefDecisions,
  decodeMonthlyBriefSavedDecision,
  monthlyBriefUnavailable,
  parseMonthlyBriefDecision,
  sameMonthlyBriefEvidence,
  type MonthlyBriefDecision,
} from "../monthly-practice-brief";
import { accountRpc } from "./account-db";
import { decodeActionObservationContext } from "./action-observation-store";

if (typeof window !== "undefined")
  throw new Error("Private monthly practice briefs are server-only.");

const errors: Record<string, [string, number]> = {
  monthly_brief_not_found: ["This action is unavailable in your account.", 404],
  monthly_brief_not_decidable: [
    "This brief no longer has the period or figures needed for that choice. Refresh before saving.",
    409,
  ],
  monthly_brief_conflict: [
    "The brief or its saved decision changed. Refresh and review it before saving.",
    409,
  ],
  invalid_monthly_brief_decision: [
    "Review this brief and choose a decision using its current figures.",
    400,
  ],
};

function requireOwner(id: string) {
  if (!accountUuid(id))
    throw new AccountDataError(
      "invalid_account",
      "Sign in to see your private practice brief.",
      401,
    );
}

export function createMonthlyPracticeBriefStore(
  rpc: typeof accountRpc = accountRpc,
  now: () => Date = () => new Date(),
) {
  async function call(name: string, parameters: Record<string, unknown>) {
    let value: unknown;
    try {
      value = await rpc(name, parameters);
    } catch {
      throw monthlyBriefUnavailable();
    }
    if (accountRecord(value) && Object.hasOwn(value, "error")) {
      const code = value.error;
      const known =
        typeof code === "string" && Object.hasOwn(errors, code)
          ? errors[code]
          : null;
      if (known && typeof code === "string")
        throw new AccountDataError(code, known[0], known[1]);
      throw monthlyBriefUnavailable();
    }
    return value;
  }
  return {
    async read(userId: string) {
      requireOwner(userId);
      const value = await call("grader_read_monthly_brief_context", {
        p_user_id: userId,
      });
      if (!accountRecord(value)) throw monthlyBriefUnavailable();
      const { decisions } = decodeMonthlyBriefDecisions(value.decisions);
      const time = now();
      try {
        const context = decodeActionObservationContext(value.context, time);
        const observedIds = new Set(context.observations.map((o) => o.id));
        if (decisions.some((d) => !observedIds.has(d.observationId)))
          throw monthlyBriefUnavailable();
        return buildMonthlyPracticeBriefs(context, decisions, time);
      } catch {
        throw monthlyBriefUnavailable();
      }
    },
    async decide(userId: string, body: unknown): Promise<MonthlyBriefDecision> {
      requireOwner(userId);
      const input = parseMonthlyBriefDecision(body);
      const stored = decodeMonthlyBriefSavedDecision(
        await call("grader_save_monthly_brief_decision", {
          p_user_id: userId,
          p_observation_id: input.observationId,
          p_choice: input.choice,
          p_expected_revision: input.expectedDecisionRevision,
          p_evidence: input.evidence,
        }),
      );
      if (
        stored.observationId !== input.observationId ||
        stored.choice !== input.choice ||
        !sameMonthlyBriefEvidence(stored.evidence, input.evidence)
      )
        throw monthlyBriefUnavailable();
      return {
        choice: stored.choice,
        revision: stored.revision,
        savedAt: stored.savedAt,
        current: true,
      };
    },
    async exportOwn(userId: string) {
      requireOwner(userId);
      return decodeMonthlyBriefDecisions(
        await call("grader_read_monthly_brief_decisions", {
          p_user_id: userId,
        }),
      );
    },
  };
}

export function exportOwnMonthlyBriefDecisions(userId: string) {
  return createMonthlyPracticeBriefStore().exportOwn(userId);
}
