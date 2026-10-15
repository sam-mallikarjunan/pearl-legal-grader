import { Buffer } from "node:buffer";
import { isWebsiteScanResult, type WebsiteScanResult } from "../website/types";

if (typeof window !== "undefined")
  throw new Error("Scan persistence must run on the server.");

export type PersistedScanStatus =
  | "queued"
  | "running"
  | "complete"
  | "partial"
  | "unavailable";
export type ScanLimitCode = "client_limit" | "global_limit" | "domain_cooldown";

export class ScanLimitError extends Error {
  readonly status = 429;
  constructor(
    public readonly code: ScanLimitCode,
    public readonly retryAfterSeconds: number,
  ) {
    super(
      code === "domain_cooldown"
        ? "This website was checked recently. Please wait before requesting a new check."
        : code === "client_limit"
          ? "You’ve reached the preview’s scan request limit. Please try again later."
          : "The preview has reached its scan allowance. Please try again later.",
    );
    this.name = "ScanLimitError";
  }
}
export class ScanConfigError extends Error {
  readonly status = 503;
  readonly code = "scan_not_configured";
  constructor() {
    super("Live website checks are not configured on this deployment yet.");
    this.name = "ScanConfigError";
  }
}
export class ScanDatabaseError extends Error {
  readonly status = 503;
  readonly code = "scan_storage_unavailable";
  constructor() {
    super(
      "The scan service is temporarily unavailable. Please try again later.",
    );
    this.name = "ScanDatabaseError";
  }
}

export interface ReserveScanInput {
  id: string;
  url: string;
  urlHash: string;
  tokenHash: string;
  clientHash: string;
  scannerVersion: string;
  rubricVersion: string;
  force: boolean;
}
export interface PersistedScan {
  scanId: string;
  status: PersistedScanStatus;
  stage: string;
  result?: WebsiteScanResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
export interface ReservedScan extends PersistedScan {
  cached: boolean;
  start: boolean;
}
export interface ScanStore {
  reserveScan(input: ReserveScanInput): Promise<ReservedScan>;
  readScan(scanId: string, tokenHash: string): Promise<PersistedScan | null>;
  claimScan(scanId: string, leaseId: string): Promise<{ url: string } | null>;
  updateScanProgress(
    scanId: string,
    leaseId: string,
    stage: string,
  ): Promise<void>;
  completeScan(
    scanId: string,
    leaseId: string,
    result: WebsiteScanResult,
  ): Promise<void>;
  failScan(scanId: string, leaseId: string, safeError: string): Promise<void>;
  recordWorkflowRun(scanId: string, runId: string): Promise<void>;
  purgeExpiredScans(): Promise<void>;
}
interface ScanStoreOptions {
  url: string;
  key: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const date = (value: unknown): value is string =>
  string(value, 50) && Number.isFinite(Date.parse(value));
const nonempty = (value: unknown, max: number): value is string =>
  string(value, max) && value.trim().length > 0;
const statuses: string[] = [
  "queued",
  "running",
  "complete",
  "partial",
  "unavailable",
];
function validPublicUrl(value: unknown): value is string {
  if (!string(value, 2048)) return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
function validJob(value: unknown): value is PersistedScan {
  return (
    record(value) &&
    uuid(value.scanId) &&
    typeof value.status === "string" &&
    statuses.includes(value.status) &&
    string(value.stage, 300) &&
    date(value.createdAt) &&
    date(value.updatedAt) &&
    date(value.expiresAt) &&
    (value.error === undefined || string(value.error, 1000)) &&
    (value.result === undefined
      ? !["complete", "partial"].includes(value.status)
      : isWebsiteScanResult(value.result) &&
        value.result.status === value.status)
  );
}
function assertId(id: string) {
  if (!uuid(id)) throw new ScanDatabaseError();
}
function assertLease(leaseId: string) {
  if (!nonempty(leaseId, 200)) throw new ScanDatabaseError();
}

/** Credentials remain in this server-only adapter; public clients receive capabilities. */
export function createScanStore(options: ScanStoreOptions): ScanStore {
  let baseUrl: URL;
  const key = options.key.trim();
  try {
    baseUrl = new URL(options.url);
    const hosted =
      baseUrl.protocol === "https:" &&
      (baseUrl.hostname.endsWith(".supabase.co") ||
        baseUrl.hostname.endsWith(".supabase.in"));
    const local =
      process.env.NODE_ENV !== "production" &&
      baseUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname);
    if (
      (!hosted && !local) ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash ||
      baseUrl.pathname !== "/"
    )
      throw new Error();
  } catch {
    throw new ScanConfigError();
  }
  const modern = /^sb_secret_[a-zA-Z0-9_-]{10,500}$/.test(key);
  let legacy = false;
  if (!modern && /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(key)) {
    try {
      legacy =
        JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"))
          .role === "service_role";
    } catch {}
  }
  if (!modern && !legacy) throw new ScanConfigError();
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const rpc = async (
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> => {
    let response: Response;
    try {
      const headers: Record<string, string> = {
        apikey: key,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "PearlLegalGraderServer/1.0",
      };
      if (legacy) headers.Authorization = `Bearer ${key}`;
      response = await fetcher(new URL(`/rest/v1/rpc/${name}`, baseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new ScanDatabaseError();
    }
    let data: unknown = null;
    try {
      const text = await response.text();
      if (Buffer.byteLength(text) > 1_500_000) throw new Error();
      if (text) data = JSON.parse(text);
    } catch {
      throw new ScanDatabaseError();
    }
    if (!response.ok) {
      if (
        record(data) &&
        data.code === "P0001" &&
        ["client_limit", "global_limit", "domain_cooldown"].includes(
          data.message as string,
        )
      ) {
        const retry =
          typeof data.details === "string" && /^\d+$/.test(data.details)
            ? Number(data.details)
            : data.message === "domain_cooldown"
              ? 900
              : 3600;
        throw new ScanLimitError(
          data.message as ScanLimitCode,
          Math.min(
            31 * 86400,
            Math.max(1, Number.isSafeInteger(retry) ? retry : 3600),
          ),
        );
      }
      // Database bodies can contain credentials or infrastructure detail. Never
      // attach them as an error message or cause, including in server logs.
      throw new ScanDatabaseError();
    }
    return data;
  };
  return {
    async reserveScan(input) {
      if (
        !uuid(input.id) ||
        !validPublicUrl(input.url) ||
        !hash(input.urlHash) ||
        !hash(input.tokenHash) ||
        !hash(input.clientHash) ||
        !nonempty(input.scannerVersion, 80) ||
        !nonempty(input.rubricVersion, 80) ||
        typeof input.force !== "boolean"
      )
        throw new ScanDatabaseError();
      const data = await rpc("reserve_website_scan", {
        p_id: input.id,
        p_url: input.url,
        p_url_hash: input.urlHash,
        p_token_hash: input.tokenHash,
        p_client_hash: input.clientHash,
        p_scanner_version: input.scannerVersion,
        p_rubric_version: input.rubricVersion,
        p_force: input.force,
      });
      if (
        !record(data) ||
        typeof data.cached !== "boolean" ||
        typeof data.start !== "boolean" ||
        !validJob(data)
      )
        throw new ScanDatabaseError();
      return {
        ...data,
        cached: data.cached === true,
        start: data.start === true,
      };
    },
    async readScan(scanId, tokenHash) {
      assertId(scanId);
      if (!hash(tokenHash)) return null;
      const data = await rpc("read_website_scan", {
        p_id: scanId,
        p_token_hash: tokenHash,
      });
      if (data === null) return null;
      if (!validJob(data)) throw new ScanDatabaseError();
      return data;
    },
    async claimScan(scanId, leaseId) {
      assertId(scanId);
      assertLease(leaseId);
      const data = await rpc("claim_website_scan", {
        p_id: scanId,
        p_lease_id: leaseId,
      });
      if (data === null) return null;
      if (!record(data) || !validPublicUrl(data.url))
        throw new ScanDatabaseError();
      return { url: data.url };
    },
    async updateScanProgress(scanId, leaseId, stage) {
      assertId(scanId);
      assertLease(leaseId);
      if (!string(stage, 300)) throw new ScanDatabaseError();
      await rpc("update_website_scan_progress", {
        p_id: scanId,
        p_lease_id: leaseId,
        p_stage: stage,
      });
    },
    async completeScan(scanId, leaseId, result) {
      assertId(scanId);
      assertLease(leaseId);
      if (
        !isWebsiteScanResult(result) ||
        Buffer.byteLength(JSON.stringify(result)) > 1_000_000
      )
        throw new ScanDatabaseError();
      await rpc("complete_website_scan", {
        p_id: scanId,
        p_lease_id: leaseId,
        p_result: result,
      });
    },
    async failScan(scanId, leaseId, safeError) {
      assertId(scanId);
      assertLease(leaseId);
      if (!string(safeError, 1000)) throw new ScanDatabaseError();
      await rpc("fail_website_scan", {
        p_id: scanId,
        p_lease_id: leaseId,
        p_safe_error: safeError,
      });
    },
    async recordWorkflowRun(scanId, runId) {
      assertId(scanId);
      assertLease(runId);
      await rpc("record_website_scan_workflow", {
        p_id: scanId,
        p_run_id: runId,
      });
    },
    async purgeExpiredScans() {
      await rpc("purge_expired_website_scans");
    },
  };
}

function configuredStore(): ScanStore {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!url || !key) throw new ScanConfigError();
  return createScanStore({ url, key });
}
export const reserveScan = (input: ReserveScanInput) =>
  configuredStore().reserveScan(input);
export const readScan = (scanId: string, tokenHash: string) =>
  configuredStore().readScan(scanId, tokenHash);
export const claimScan = (scanId: string, leaseId: string) =>
  configuredStore().claimScan(scanId, leaseId);
export const updateScanProgress = (
  scanId: string,
  leaseId: string,
  stage: string,
) => configuredStore().updateScanProgress(scanId, leaseId, stage);
export const completeScan = (
  scanId: string,
  leaseId: string,
  result: WebsiteScanResult,
) => configuredStore().completeScan(scanId, leaseId, result);
export const failScan = (scanId: string, leaseId: string, safeError: string) =>
  configuredStore().failScan(scanId, leaseId, safeError);
export const recordWorkflowRun = (scanId: string, runId: string) =>
  configuredStore().recordWorkflowRun(scanId, runId);
export const purgeExpiredScans = () => configuredStore().purgeExpiredScans();
