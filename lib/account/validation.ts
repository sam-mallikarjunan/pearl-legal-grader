import { DEFAULT_RELEASE } from "../catalog";
import { assessPractice } from "../scoring";
import {
  emptyStore,
  isActionProgress,
  parseStore,
  type ActionProgress,
  type ActionState,
  type SavedAssessment,
} from "../storage";
import type { ReleaseSnapshot } from "../types";
import {
  ACCOUNT_CONSENT_VERSION,
  ACCOUNT_PREFERENCE_KEYS,
} from "./validation-constants";
import {
  ACCOUNT_REPORT_BYTES,
  type AccountPreferenceValues,
  type SaveAccountReportInput,
} from "./types";

export class AccountDataError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AccountDataError";
  }
}
export const accountRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const accountUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v);
export const validActionState = (v: unknown): v is ActionState =>
  typeof v === "string" &&
  ["todo", "in_progress", "done", "deferred", "not_relevant"].includes(v);
export const validRevision = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (accountRecord(value))
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new AccountDataError(
      "invalid_fields",
      "This request contains unsupported fields.",
    );
}
function hasCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCredentialField);
  if (!accountRecord(value)) return false;
  return Object.entries(value).some(
    ([key, item]) =>
      /^(access_?token|refresh_?token|password|secret|authorization|cookie|api_?key|websiteAccess)$/i.test(
        key,
      ) || hasCredentialField(item),
  );
}
export function reportReleaseId(value: unknown): string {
  if (
    !accountRecord(value) ||
    !accountRecord(value.report) ||
    !accountRecord(value.report.assessment) ||
    typeof value.report.assessment.releaseId !== "string" ||
    value.report.assessment.releaseId.length > 120
  )
    throw new AccountDataError(
      "invalid_report",
      "Choose a valid saved report.",
    );
  return value.report.assessment.releaseId;
}

/** Only trusted published rubrics and deterministically reproduced issued scores can be saved. */
export function parseAccountReport(
  value: unknown,
  trustedRelease: ReleaseSnapshot = DEFAULT_RELEASE,
): SaveAccountReportInput {
  if (!accountRecord(value))
    throw new AccountDataError("invalid_report", "Choose a saved report.");
  onlyKeys(value, [
    "report",
    "actionStates",
    "actionProgress",
    "websiteAccess",
  ]);
  const report = value.report;
  if (!accountRecord(report) || hasCredentialField(report))
    throw new AccountDataError(
      "invalid_report",
      "The report contains unsupported data.",
    );
  onlyKeys(report, [
    "id",
    "practiceId",
    "baselineId",
    "createdAt",
    "label",
    "isSample",
    "assessment",
    "websiteScan",
  ]);
  if (
    report.isSample !== false ||
    !accountUuid(report.id) ||
    !accountUuid(report.practiceId) ||
    (report.baselineId !== undefined &&
      (!accountUuid(report.baselineId) || report.baselineId === report.id)) ||
    typeof report.label !== "string" ||
    report.label.length > 200 ||
    typeof report.createdAt !== "string" ||
    !Number.isFinite(Date.parse(report.createdAt)) ||
    Date.parse(report.createdAt) > Date.now() + 300_000
  )
    throw new AccountDataError(
      "invalid_report",
      "Save a real practice report with valid identifiers and dates.",
    );
  const wrapper = emptyStore();
  wrapper.assessments = [report as unknown as SavedAssessment];
  if (!parseStore(JSON.stringify(wrapper)))
    throw new AccountDataError(
      "invalid_report",
      "This saved report is incomplete or unsupported.",
    );
  const snapshot = report as unknown as SavedAssessment;
  const assessment = snapshot.assessment;
  if (
    snapshot.websiteScan &&
    (assessment.contextSnapshot.websiteStatus !== "has_site" ||
      !assessment.contextSnapshot.websiteUrl ||
      new URL(assessment.contextSnapshot.websiteUrl).origin !==
        new URL(snapshot.websiteScan.submittedUrl).origin)
  )
    throw new AccountDataError(
      "invalid_website_evidence",
      "Website evidence must belong to the website named in this report.",
    );
  if (
    assessment.releaseId !== trustedRelease.id ||
    canonicalJson(assessment.releaseSnapshot) !== canonicalJson(trustedRelease)
  )
    throw new AccountDataError(
      "noncanonical_release",
      "This report uses browser-only scoring changes. Create a report with the published rubric before saving to your account.",
      409,
    );
  if (
    assessment.contextSnapshot.practiceArea.length > 200 ||
    assessment.contextSnapshot.jurisdiction.length > 200 ||
    (assessment.contextSnapshot.capacityAdditionalMatters !== null &&
      (assessment.contextSnapshot.capacityAdditionalMatters < 0 ||
        assessment.contextSnapshot.capacityAdditionalMatters > 100_000))
  )
    throw new AccountDataError(
      "invalid_context",
      "Use short practice details and a valid capacity range.",
    );
  const allowedQuestions = new Set(trustedRelease.questions.map((q) => q.id));
  if (
    Object.keys(assessment.answersSnapshot).some(
      (id) => !allowedQuestions.has(id),
    )
  )
    throw new AccountDataError(
      "invalid_answers",
      "The report contains answers outside the published rubric.",
    );
  const recomputed = assessPractice({
    context: assessment.contextSnapshot,
    answers: assessment.answersSnapshot,
    controls: assessment.controlsSnapshot,
    release: trustedRelease,
  });
  if (canonicalJson(recomputed) !== canonicalJson(assessment))
    throw new AccountDataError(
      "noncanonical_scores",
      "This report no longer matches its saved answers and published rubric. Create a new report before saving.",
      409,
    );
  const canonical: SavedAssessment = {
    id: snapshot.id,
    practiceId: snapshot.practiceId,
    ...(snapshot.baselineId ? { baselineId: snapshot.baselineId } : {}),
    createdAt: snapshot.createdAt,
    label: snapshot.label.trim() || "Your practice",
    isSample: false,
    assessment: recomputed,
    ...(snapshot.websiteScan
      ? { websiteScan: structuredClone(snapshot.websiteScan) }
      : {}),
  };
  const allowedActions = new Set(recomputed.actions.map((action) => action.id));
  const actionStates: Record<string, ActionState> = {};
  const actionProgress: Record<string, ActionProgress> = {};
  for (const [field, target, validate] of [
    ["actionStates", actionStates, validActionState],
    ["actionProgress", actionProgress, isActionProgress],
  ] as const) {
    if (value[field] !== undefined && !accountRecord(value[field]))
      throw new AccountDataError(
        "invalid_progress",
        "Action progress must be a small named map.",
      );
    for (const [id, item] of Object.entries(value[field] ?? {})) {
      if (
        !allowedActions.has(id) ||
        !validate(item) ||
        hasCredentialField(item)
      )
        throw new AccountDataError(
          "invalid_progress",
          "Action progress must refer to an action in this report.",
        );
      (target as Record<string, unknown>)[id] = structuredClone(item);
    }
  }
  let websiteAccess: SaveAccountReportInput["websiteAccess"];
  if (value.websiteAccess !== undefined) {
    if (!accountRecord(value.websiteAccess))
      throw new AccountDataError(
        "invalid_website_access",
        "Website evidence needs its private scan access.",
      );
    onlyKeys(value.websiteAccess, ["scanId", "accessToken"]);
    if (
      !accountUuid(value.websiteAccess.scanId) ||
      typeof value.websiteAccess.accessToken !== "string" ||
      !/^[a-zA-Z0-9_-]{24,512}$/.test(value.websiteAccess.accessToken)
    )
      throw new AccountDataError(
        "invalid_website_access",
        "Website evidence needs valid private scan access.",
      );
    websiteAccess = {
      scanId: value.websiteAccess.scanId,
      accessToken: value.websiteAccess.accessToken,
    };
  }
  if (
    new TextEncoder().encode(JSON.stringify(canonical)).byteLength >
    ACCOUNT_REPORT_BYTES
  )
    throw new AccountDataError(
      "report_too_large",
      "This report is too large to save.",
      413,
    );
  return {
    report: canonical,
    actionStates,
    actionProgress,
    ...(websiteAccess ? { websiteAccess } : {}),
  };
}
export function parseProgressUpdate(value: unknown) {
  if (!accountRecord(value))
    throw new AccountDataError(
      "invalid_progress",
      "Choose an action and status.",
    );
  onlyKeys(value, ["actionId", "state", "revision", "details"]);
  if (
    typeof value.actionId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(value.actionId) ||
    !validActionState(value.state) ||
    !validRevision(value.revision) ||
    (value.details !== undefined &&
      (!isActionProgress(value.details) || hasCredentialField(value.details)))
  )
    throw new AccountDataError(
      "invalid_progress",
      "Choose a valid action, status and saved revision.",
    );
  return {
    actionId: value.actionId,
    state: value.state,
    revision: value.revision,
    ...(value.details
      ? { details: structuredClone(value.details) as ActionProgress }
      : {}),
  };
}
export function parsePreferencesUpdate(value: unknown): {
  revision: number;
  preferences: AccountPreferenceValues;
  consentVersion: typeof ACCOUNT_CONSENT_VERSION;
} {
  if (!accountRecord(value))
    throw new AccountDataError(
      "invalid_preferences",
      "Choose your communication and data preferences.",
    );
  onlyKeys(value, ["revision", "preferences", "consentVersion"]);
  if (
    !validRevision(value.revision) ||
    value.consentVersion !== ACCOUNT_CONSENT_VERSION ||
    !accountRecord(value.preferences)
  )
    throw new AccountDataError(
      "invalid_preferences",
      "Review the current preference wording before saving.",
    );
  onlyKeys(value.preferences, [...ACCOUNT_PREFERENCE_KEYS]);
  if (
    !ACCOUNT_PREFERENCE_KEYS.every(
      (key) =>
        typeof (value.preferences as Record<string, unknown>)[key] ===
        "boolean",
    )
  )
    throw new AccountDataError(
      "invalid_preferences",
      "Set each preference explicitly.",
    );
  return {
    revision: value.revision,
    preferences: { ...value.preferences } as AccountPreferenceValues,
    consentVersion: ACCOUNT_CONSENT_VERSION,
  };
}
