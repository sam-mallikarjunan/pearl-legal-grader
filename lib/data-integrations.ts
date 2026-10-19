import { accountRecord, accountUuid } from "./account/validation";
import {
  parseOutcomeImportInput,
  OUTCOME_IMPORT_CONFIRMATION,
} from "./outcome-batch-import";
import { parseOutcomePeriodInput, type OutcomePeriodInput } from "./outcomes";

export const CREATE_DATA_CONNECTION_CONFIRMATION =
  "CREATE AGGREGATE CONNECTION";
export const DATA_INTEGRATION_LIMITS = {
  activeConnections: 3,
  retainedConnections: 24,
  pendingDeliveries: 5,
  retainedDeliveries: 100,
  deliveriesPerDay: 10,
  connectionDays: 30,
  deliveryDays: 7,
} as const;
export interface DataConnection {
  id: string;
  revision: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastReceivedAt: string | null;
  hint: string;
}
export type DataDeliveryStatus =
  | "pending"
  | "imported"
  | "discarded"
  | "expired";
export interface DataDeliverySummary {
  id: string;
  revision: number;
  connectionId: string;
  createdAt: string;
  expiresAt: string;
  status: DataDeliveryStatus;
  periodCount: number;
  importBatchId: string | null;
}
export interface DataDelivery extends DataDeliverySummary {
  periods: OutcomePeriodInput[] | null;
}
export class DataIntegrationError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "DataIntegrationError";
  }
}
const invalid = () =>
  new DataIntegrationError(
    "invalid_delivery",
    "Send 1–24 closed aggregate periods using the documented fields. Client, matter, contact, credential and owner fields are not accepted.",
  );
const unavailable = () =>
  new DataIntegrationError(
    "data_integration_unavailable",
    "Your private data connection is temporarily unavailable. Refresh before trying again.",
    503,
  );
const revision = (v: unknown): v is number =>
  Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 1_000_000;
const stamp = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v));
export function parseCreateDataConnection(value: unknown) {
  if (
    !accountRecord(value) ||
    Object.keys(value).length !== 1 ||
    value.confirm !== CREATE_DATA_CONNECTION_CONFIRMATION
  )
    throw new DataIntegrationError(
      "connection_confirmation_required",
      "Confirm creating a write-only aggregate totals connection.",
    );
}
export function parseDataDeliveryInput(value: unknown, now = new Date()) {
  if (
    !accountRecord(value) ||
    Object.keys(value).length !== 2 ||
    !accountUuid(value.requestId) ||
    !Array.isArray(value.periods)
  )
    throw invalid();
  try {
    return parseOutcomeImportInput(
      {
        requestId: value.requestId,
        periods: value.periods,
        confirm: OUTCOME_IMPORT_CONFIRMATION,
      },
      now,
    );
  } catch {
    throw invalid();
  }
}
export function parseDataIntegrationRevision(
  value: unknown,
  accepting = false,
) {
  if (
    !accountRecord(value) ||
    Object.keys(value).length !== (accepting ? 2 : 1) ||
    !revision(value.revision) ||
    (accepting && value.confirm !== OUTCOME_IMPORT_CONFIRMATION)
  )
    throw new DataIntegrationError(
      "invalid_connection_revision",
      "Refresh this saved connection or delivery and confirm the current revision.",
    );
  return value.revision;
}
export function dataIntegrationBearer(value: string | null): string {
  const found = /^Bearer (plg_in_[A-Za-z0-9_-]{43})$/.exec(value || "");
  if (!found)
    throw new DataIntegrationError(
      "invalid_connection_key",
      "The aggregate connection key is missing, expired or revoked.",
      401,
    );
  return found[1];
}
export function decodeDataConnection(value: unknown): DataConnection {
  if (
    !accountRecord(value) ||
    !accountUuid(value.id) ||
    !revision(value.revision) ||
    !stamp(value.createdAt) ||
    !stamp(value.expiresAt) ||
    !(value.revokedAt === null || stamp(value.revokedAt)) ||
    !(value.lastReceivedAt === null || stamp(value.lastReceivedAt)) ||
    typeof value.hint !== "string" ||
    !/^[A-Za-z0-9_-]{4}$/.test(value.hint)
  )
    throw unavailable();
  return {
    id: value.id,
    revision: value.revision,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    revokedAt: value.revokedAt,
    lastReceivedAt: value.lastReceivedAt,
    hint: value.hint,
  };
}
export function decodeDataDeliverySummary(value: unknown): DataDeliverySummary {
  if (
    !accountRecord(value) ||
    !accountUuid(value.id) ||
    !accountUuid(value.connectionId) ||
    !revision(value.revision) ||
    !stamp(value.createdAt) ||
    !stamp(value.expiresAt) ||
    !["pending", "imported", "discarded", "expired"].includes(
      String(value.status),
    ) ||
    !Number.isInteger(value.periodCount) ||
    Number(value.periodCount) < 1 ||
    Number(value.periodCount) > 24 ||
    !(value.importBatchId === null || accountUuid(value.importBatchId)) ||
    (value.status === "imported" && value.importBatchId === null) ||
    (value.status !== "imported" && value.importBatchId !== null)
  )
    throw unavailable();
  return {
    id: value.id,
    connectionId: value.connectionId,
    revision: value.revision,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    status: value.status as DataDeliveryStatus,
    periodCount: Number(value.periodCount),
    importBatchId: value.importBatchId as string | null,
  };
}
export function decodeDataDelivery(value: unknown): DataDelivery {
  const summary = decodeDataDeliverySummary(value);
  if (!accountRecord(value)) throw unavailable();
  if (summary.status !== "pending") {
    if (value.periods !== null) throw unavailable();
    return { ...summary, periods: null };
  }
  if (
    !Array.isArray(value.periods) ||
    value.periods.length !== summary.periodCount
  )
    throw unavailable();
  try {
    const periods = value.periods.map((p) => parseOutcomePeriodInput(p));
    if (
      periods.some((p) => p.source !== "export" || p.baselineReportId !== null)
    )
      throw unavailable();
    return { ...summary, periods };
  } catch {
    throw unavailable();
  }
}
