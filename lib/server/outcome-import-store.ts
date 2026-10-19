import { createHash } from "node:crypto";
import {
  accountRecord,
  accountUuid,
  canonicalJson,
} from "../account/validation";
import {
  decodeOutcomeImportResult,
  OUTCOME_IMPORT_MAX_BATCHES,
  parseOutcomeImportInput,
} from "../outcome-batch-import";
import { OutcomeInputError } from "../outcomes";
import { accountRpc } from "./account-db";

if (typeof window !== "undefined")
  throw new Error("Private aggregate imports run on the server.");
export class OutcomeImportStorageError extends Error {
  readonly code = "outcome_import_unavailable";
  readonly status = 503;
  constructor() {
    super(
      "Your private import is temporarily unavailable. Nothing is reported as imported without a verified receipt.",
    );
  }
}
const errors: Record<string, [string, number]> = {
  outcome_import_request_conflict: [
    "This import request already has different totals. Review the changed rows as a new import.",
    409,
  ],
  outcome_import_overlap: [
    "A reviewed period overlaps saved data or a registered plan. Nothing was imported.",
    409,
  ],
  outcome_period_overlap: [
    "A reviewed period overlaps saved data. Nothing was imported.",
    409,
  ],
  outcome_plan_overlap: [
    "A reviewed period belongs to a registered plan. Use that plan to report it. Nothing was imported.",
    409,
  ],
  outcome_period_limit: [
    "This import would exceed 24 saved periods. Nothing was imported. Export or remove an old period first.",
    429,
  ],
  outcome_import_limit: [
    "This account has reached its 100-import preview allowance. Saved periods, export and deletion remain available.",
    429,
  ],
  outcome_change_limit: [
    "The period-change allowance is full. Nothing was imported; export and deletion remain available.",
    429,
  ],
  invalid_outcome_import: [
    "Use reviewed aggregate totals only. Nothing was imported.",
    400,
  ],
  invalid_outcome: [
    "One reviewed period is invalid. Nothing was imported.",
    400,
  ],
};
function owner(id: string) {
  if (!accountUuid(id))
    throw new OutcomeInputError(
      "invalid_account",
      "Sign in to import your own aggregate periods.",
      401,
    );
}
export function createOutcomeImportStore(d: {
  rpc: typeof accountRpc;
  now?: () => Date;
}) {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    try {
      const v = await d.rpc(name, args);
      if (accountRecord(v) && typeof v.error === "string") {
        const e = errors[v.error];
        if (e) throw new OutcomeInputError(v.error, e[0], e[1]);
        throw new OutcomeImportStorageError();
      }
      return v;
    } catch (e) {
      if (
        e instanceof OutcomeInputError ||
        e instanceof OutcomeImportStorageError
      )
        throw e;
      if (accountRecord(e) && typeof e.code === "string" && errors[e.code]) {
        const x = errors[e.code];
        throw new OutcomeInputError(e.code, x[0], x[1]);
      }
      throw new OutcomeImportStorageError();
    }
  };
  return {
    async importRows(userId: string, body: unknown) {
      owner(userId);
      const input = parseOutcomeImportInput(body, d.now?.());
      const hash = createHash("sha256")
        .update(canonicalJson(input.periods))
        .digest("hex");
      return decodeOutcomeImportResult(
        await rpc("grader_import_outcome_periods", {
          p_user_id: userId,
          p_request: input.requestId,
          p_hash: hash,
          p_periods: input.periods,
        }),
      );
    },
    async exportOwn(userId: string) {
      owner(userId);
      const v = await rpc("grader_export_outcome_imports", {
        p_user_id: userId,
      });
      if (
        !accountRecord(v) ||
        !Array.isArray(v.imports) ||
        v.imports.length > OUTCOME_IMPORT_MAX_BATCHES
      )
        throw new OutcomeImportStorageError();
      const imports = v.imports.map((row: unknown) => {
        if (
          !accountRecord(row) ||
          !accountUuid(row.batchId) ||
          typeof row.importedAt !== "string" ||
          !Number.isFinite(Date.parse(row.importedAt)) ||
          !Number.isSafeInteger(row.periodCount) ||
          Number(row.periodCount) < 1 ||
          Number(row.periodCount) > 24 ||
          !Number.isSafeInteger(row.activePeriodCount) ||
          Number(row.activePeriodCount) < 0 ||
          Number(row.activePeriodCount) > Number(row.periodCount)
        )
          throw new OutcomeImportStorageError();
        return {
          batchId: row.batchId,
          importedAt: row.importedAt,
          periodCount: Number(row.periodCount),
          activePeriodCount: Number(row.activePeriodCount),
        };
      });
      if (new Set(imports.map((r) => r.batchId)).size !== imports.length)
        throw new OutcomeImportStorageError();
      return { imports, maximumRetainedBatches: OUTCOME_IMPORT_MAX_BATCHES };
    },
  };
}
const configured = () => createOutcomeImportStore({ rpc: accountRpc });
export const importOwnOutcomes = (userId: string, body: unknown) =>
  configured().importRows(userId, body);
export const exportOwnOutcomeImports = (userId: string) =>
  configured().exportOwn(userId);
