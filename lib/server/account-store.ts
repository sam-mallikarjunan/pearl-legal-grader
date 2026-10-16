import { createHash } from "node:crypto";
import { accountRpc } from "./account-db";
import { getApprovedConfigRelease } from "./config-store";
import { readScan } from "./scan-store";
import { tokenDigest } from "./scan-security";
import {
  emptyStore,
  isActionProgress,
  parseStore,
  type SavedAssessment,
} from "../storage";
import {
  ACCOUNT_CONSENT_TEXT,
  ACCOUNT_CONSENT_VERSION,
  ACCOUNT_REPORT_LIMIT,
  type AccountConsentEvent,
  type AccountExport,
  type AccountPreferences,
  type CloudActionProgress,
  type CloudReport,
} from "../account/types";
import { ACCOUNT_PREFERENCE_KEYS } from "../account/validation-constants";
import {
  AccountDataError,
  accountRecord,
  accountUuid,
  canonicalJson,
  parseAccountReport,
  parsePreferencesUpdate,
  parseProgressUpdate,
  reportReleaseId,
  validActionState,
  validRevision,
} from "../account/validation";

if (typeof window !== "undefined")
  throw new Error("Account persistence must run on the server.");

export class AccountStorageError extends Error {
  readonly code = "account_storage_unavailable";
  readonly status = 503;
  constructor() {
    super(
      "Your private account is temporarily unavailable. Your device copy is still available.",
    );
    this.name = "AccountStorageError";
  }
}
interface StoreDependencies {
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  readScan: typeof readScan;
  approvedRelease: typeof getApprovedConfigRelease;
}
const stamp = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 50 &&
  Number.isFinite(Date.parse(value));
function rpcError(value: unknown) {
  if (!accountRecord(value) || typeof value.error !== "string") return;
  const errors: Record<string, [number, string]> = {
    not_found: [404, "This report is unavailable in your account."],
    report_conflict: [
      409,
      "This saved report already exists with different content. Create a new report to preserve the original.",
    ],
    revision_conflict: [
      409,
      "This item changed on another device. Refresh your account before saving again.",
    ],
    report_limit: [
      429,
      "Your preview account has reached its saved-report allowance. Export or remove an older report first.",
    ],
    storage_limit: [
      429,
      "Your preview account has reached its storage allowance. Export or remove an older report first.",
    ],
    preference_limit: [
      429,
      "This preview has reached its preference-change allowance. Please try again later.",
    ],
    invalid_baseline: [400, "A baseline must belong to the same practice."],
    invalid_action: [400, "Choose an action from this report."],
  };
  const error = errors[value.error];
  if (error) throw new AccountDataError(value.error, error[1], error[0]);
  throw new AccountStorageError();
}
function userId(value: string) {
  if (!accountUuid(value)) throw new AccountStorageError();
}
function reportId(value: string) {
  if (!accountUuid(value))
    throw new AccountDataError(
      "not_found",
      "This report is unavailable in your account.",
      404,
    );
}
function progress(value: unknown): CloudActionProgress {
  if (
    !accountRecord(value) ||
    typeof value.actionId !== "string" ||
    value.actionId.length > 100 ||
    !validActionState(value.state) ||
    !validRevision(value.revision) ||
    !stamp(value.updatedAt) ||
    (value.details !== undefined &&
      value.details !== null &&
      !isActionProgress(value.details))
  )
    throw new AccountStorageError();
  return {
    actionId: value.actionId,
    state: value.state,
    revision: value.revision,
    updatedAt: value.updatedAt,
    ...(value.details ? { details: value.details } : {}),
  } as CloudActionProgress;
}
function decodeReport(value: unknown): CloudReport {
  rpcError(value);
  if (
    !accountRecord(value) ||
    !accountUuid(value.id) ||
    value.canonical !== true ||
    !stamp(value.savedAt) ||
    !accountRecord(value.snapshot) ||
    !Array.isArray(value.actionProgress) ||
    value.actionProgress.length > 100
  )
    throw new AccountStorageError();
  const wrapper = emptyStore();
  wrapper.assessments = [value.snapshot as unknown as SavedAssessment];
  const parsed = parseStore(JSON.stringify(wrapper));
  if (
    !parsed ||
    parsed.assessments[0].isSample ||
    !accountUuid(parsed.assessments[0].id)
  )
    throw new AccountStorageError();
  const actionIds = new Set(
    parsed.assessments[0].assessment.actions.map((action) => action.id),
  );
  const actionProgress = value.actionProgress.map(progress);
  if (actionProgress.some((action) => !actionIds.has(action.actionId)))
    throw new AccountStorageError();
  // Only the immutable report and public progress contract leave this adapter.
  return {
    id: value.id,
    snapshot: parsed.assessments[0],
    actionProgress,
    savedAt: value.savedAt,
    canonical: true,
  };
}
function decodePreferences(value: unknown): AccountPreferences {
  rpcError(value);
  if (
    !accountRecord(value) ||
    !accountRecord(value.values) ||
    !ACCOUNT_PREFERENCE_KEYS.every(
      (key) =>
        typeof (value.values as Record<string, unknown>)[key] === "boolean",
    ) ||
    !validRevision(value.revision) ||
    !(value.updatedAt === null || stamp(value.updatedAt)) ||
    value.consentVersion !== ACCOUNT_CONSENT_VERSION
  )
    throw new AccountStorageError();
  return {
    values: {
      reminders: value.values.reminders as boolean,
      marketing: value.values.marketing as boolean,
      benchmarking: value.values.benchmarking as boolean,
      leaderboard: value.values.leaderboard as boolean,
    },
    revision: value.revision,
    updatedAt: value.updatedAt,
    consentVersion: ACCOUNT_CONSENT_VERSION,
  };
}

/** Every caller supplies identity established by the authentication boundary, never by JSON input. */
export function createAccountStore(dependencies: StoreDependencies) {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const result = await dependencies.rpc(name, args);
    rpcError(result);
    return result;
  };
  return {
    async listReports(id: string): Promise<CloudReport[]> {
      userId(id);
      const data = await rpc("grader_list_reports", { p_user_id: id });
      if (!Array.isArray(data) || data.length > ACCOUNT_REPORT_LIMIT)
        throw new AccountStorageError();
      return data.map(decodeReport);
    },
    async readReport(id: string, report: string): Promise<CloudReport> {
      userId(id);
      reportId(report);
      return decodeReport(
        await rpc("grader_read_report", { p_user_id: id, p_report_id: report }),
      );
    },
    async saveReport(
      id: string,
      body: unknown,
    ): Promise<{ report: CloudReport; created: boolean }> {
      userId(id);
      const release = await dependencies.approvedRelease(reportReleaseId(body));
      if (!release)
        throw new AccountDataError(
          "noncanonical_release",
          "This report uses a browser-only or unavailable scoring release. Create a report with the published rubric before saving.",
          409,
        );
      const input = parseAccountReport(body, release);
      if (input.report.websiteScan) {
        if (!input.websiteAccess)
          throw new AccountDataError(
            "website_evidence_unverified",
            "The website evidence needs its original private scan access. Open the report on the device that ran the scan, or explicitly save a new owner-only copy.",
            422,
          );
        const observed = await dependencies.readScan(
          input.websiteAccess.scanId,
          tokenDigest(input.websiteAccess.accessToken),
        );
        if (
          !observed?.result ||
          canonicalJson(observed.result) !==
            canonicalJson(input.report.websiteScan)
        )
          throw new AccountDataError(
            "website_evidence_unverified",
            "The original website check is unavailable or does not match this report. Run a new check, or explicitly save a new owner-only copy.",
            422,
          );
        input.report.websiteScan = structuredClone(observed.result);
      }
      const contentHash = createHash("sha256")
        .update(canonicalJson(input.report))
        .digest("hex");
      const data = await rpc("grader_save_report", {
        p_user_id: id,
        p_snapshot: input.report,
        p_content_hash: contentHash,
        p_action_states: input.actionStates,
        p_action_details: input.actionProgress,
      });
      if (!accountRecord(data) || typeof data.created !== "boolean")
        throw new AccountStorageError();
      return { report: decodeReport(data.report), created: data.created };
    },
    async deleteReport(id: string, report: string): Promise<void> {
      userId(id);
      reportId(report);
      if (
        (await rpc("grader_delete_report", {
          p_user_id: id,
          p_report_id: report,
        })) !== true
      )
        throw new AccountDataError(
          "not_found",
          "This report is unavailable in your account.",
          404,
        );
    },
    async updateAction(
      id: string,
      report: string,
      body: unknown,
    ): Promise<CloudActionProgress> {
      userId(id);
      reportId(report);
      const input = parseProgressUpdate(body);
      return progress(
        await rpc("grader_update_action", {
          p_user_id: id,
          p_report_id: report,
          p_action_id: input.actionId,
          p_state: input.state,
          p_revision: input.revision,
          p_details: input.details ?? null,
        }),
      );
    },
    async readPreferences(id: string): Promise<AccountPreferences> {
      userId(id);
      return decodePreferences(
        await rpc("grader_read_preferences", { p_user_id: id }),
      );
    },
    async updatePreferences(
      id: string,
      body: unknown,
    ): Promise<AccountPreferences> {
      userId(id);
      const input = parsePreferencesUpdate(body);
      return decodePreferences(
        await rpc("grader_update_preferences", {
          p_user_id: id,
          p_revision: input.revision,
          p_values: input.preferences,
          p_consent_version: ACCOUNT_CONSENT_VERSION,
          p_consent_text: ACCOUNT_CONSENT_TEXT,
        }),
      );
    },
    async exportAccount(id: string): Promise<AccountExport> {
      userId(id);
      const data = await rpc("grader_export_account", { p_user_id: id });
      if (
        !accountRecord(data) ||
        !Array.isArray(data.reports) ||
        data.reports.length > ACCOUNT_REPORT_LIMIT ||
        !Array.isArray(data.consentEvents) ||
        data.consentEvents.length > 1000
      )
        throw new AccountStorageError();
      const events: AccountConsentEvent[] = data.consentEvents.map(
        (event: unknown) => {
          if (
            !accountRecord(event) ||
            !ACCOUNT_PREFERENCE_KEYS.includes(event.preference as never) ||
            typeof event.granted !== "boolean" ||
            typeof event.version !== "string" ||
            event.version.length > 100 ||
            typeof event.text !== "string" ||
            event.text.length > 1000 ||
            !stamp(event.recordedAt)
          )
            throw new AccountStorageError();
          return {
            preference: event.preference,
            granted: event.granted,
            version: event.version,
            text: event.text,
            recordedAt: event.recordedAt,
          } as AccountConsentEvent;
        },
      );
      return {
        schema: 1,
        exportedAt: new Date().toISOString(),
        reports: data.reports.map(decodeReport),
        preferences: decodePreferences(data.preferences),
        consentEvents: events,
      };
    },
    async deleteWorkspace(id: string): Promise<void> {
      userId(id);
      if ((await rpc("grader_delete_workspace", { p_user_id: id })) !== true)
        throw new AccountStorageError();
    },
  };
}
const configured = () =>
  createAccountStore({
    rpc: accountRpc,
    readScan,
    approvedRelease: getApprovedConfigRelease,
  });
export const listAccountReports = (id: string) => configured().listReports(id);
export const readAccountReport = (id: string, report: string) =>
  configured().readReport(id, report);
export const saveAccountReport = (id: string, body: unknown) =>
  configured().saveReport(id, body);
export const deleteAccountReport = (id: string, report: string) =>
  configured().deleteReport(id, report);
export const updateAccountAction = (
  id: string,
  report: string,
  body: unknown,
) => configured().updateAction(id, report, body);
export const readAccountPreferences = (id: string) =>
  configured().readPreferences(id);
export const updateAccountPreferences = (id: string, body: unknown) =>
  configured().updatePreferences(id, body);
export const exportAccount = (id: string) => configured().exportAccount(id);
export const deleteAccountWorkspace = (id: string) =>
  configured().deleteWorkspace(id);
