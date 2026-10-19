import { accountRecord, accountUuid } from "./account/validation";
import {
  OutcomeInputError,
  outcomePeriodsOverlap,
  parseOutcomePeriodInput,
  type OutcomePeriodInput,
} from "./outcomes";

export const OUTCOME_IMPORT_CONFIRMATION = "IMPORT REVIEWED TOTALS";
export const OUTCOME_IMPORT_MAX_ROWS = 24;
export const OUTCOME_IMPORT_MAX_BATCHES = 100;
export interface OutcomeImportResult {
  batchId: string;
  periodIds: string[];
  created: boolean;
  replayed: boolean;
  activePeriodCount: number;
}

/** The network accepts reviewed aggregate fields, never a spreadsheet or mapping. */
export function parseOutcomeImportInput(value: unknown, now = new Date()) {
  if (
    !accountRecord(value) ||
    Object.keys(value).length !== 3 ||
    !accountUuid(value.requestId) ||
    value.confirm !== OUTCOME_IMPORT_CONFIRMATION ||
    !Array.isArray(value.periods) ||
    value.periods.length < 1 ||
    value.periods.length > OUTCOME_IMPORT_MAX_ROWS
  )
    throw new OutcomeInputError(
      "invalid_outcome_import",
      "Review 1–24 aggregate periods and explicitly confirm their import.",
    );
  const periods = value.periods.map((row: unknown) => {
    const p = parseOutcomePeriodInput(row, now);
    if (p.source !== "export" || p.baselineReportId !== null)
      throw new OutcomeInputError(
        "invalid_outcome_import_scope",
        "Imports contain export-informed totals only. They cannot attach or change an assessment baseline.",
      );
    return p;
  });
  periods.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      a.endDate.localeCompare(b.endDate),
  );
  if (periods.some((p, i) => i > 0 && outcomePeriodsOverlap(p, periods[i - 1])))
    throw new OutcomeInputError(
      "outcome_import_overlap",
      "The reviewed rows contain duplicate or overlapping periods. Nothing was imported.",
      409,
    );
  return {
    requestId: value.requestId,
    periods: periods as OutcomePeriodInput[],
  };
}

export function decodeOutcomeImportResult(value: unknown): OutcomeImportResult {
  if (
    !accountRecord(value) ||
    !accountUuid(value.batchId) ||
    !Array.isArray(value.periodIds) ||
    value.periodIds.length < 1 ||
    value.periodIds.length > OUTCOME_IMPORT_MAX_ROWS ||
    value.periodIds.some((id) => !accountUuid(id)) ||
    new Set(value.periodIds).size !== value.periodIds.length ||
    typeof value.created !== "boolean" ||
    typeof value.replayed !== "boolean" ||
    value.created === value.replayed ||
    !Number.isSafeInteger(value.activePeriodCount) ||
    Number(value.activePeriodCount) < 0 ||
    Number(value.activePeriodCount) > value.periodIds.length ||
    (value.created && value.activePeriodCount !== value.periodIds.length)
  )
    throw new OutcomeInputError(
      "outcome_import_unavailable",
      "The import receipt could not be verified. Refresh your periods before trying again.",
      503,
    );
  return {
    batchId: value.batchId,
    periodIds: [...value.periodIds] as string[],
    created: value.created,
    replayed: value.replayed,
    activePeriodCount: Number(value.activePeriodCount),
  };
}
