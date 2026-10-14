import {
  DOMAIN_IDS,
  type PracticeAssessment,
  type ReleaseSnapshot,
} from "./types";
import { DEFAULT_RELEASE } from "./catalog";
import { validateRelease } from "./scoring";

export const STORAGE_KEY = "fount.practice-grader.preview.v1";
export type ActionState = "todo" | "done" | "deferred";
export interface SavedAssessment {
  id: string;
  practiceId: string;
  baselineId?: string;
  createdAt: string;
  label: string;
  isSample: boolean;
  assessment: PracticeAssessment;
}
export interface PreviewPreferences {
  reminders: boolean;
  marketing: boolean;
  benchmarking: boolean;
  leaderboard: boolean;
}
export interface PreviewStore {
  schema: 1;
  activeRelease: ReleaseSnapshot;
  releaseHistory: ReleaseSnapshot[];
  assessments: SavedAssessment[];
  actionStates: Record<string, ActionState>;
  preferences: PreviewPreferences;
}

export function emptyStore(): PreviewStore {
  const release = structuredClone(DEFAULT_RELEASE);
  return {
    schema: 1,
    activeRelease: release,
    releaseHistory: [release],
    assessments: [],
    actionStates: {},
    preferences: {
      reminders: false,
      marketing: false,
      benchmarking: false,
      leaderboard: false,
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isScore = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0 && value <= 100;
const isCoverage = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0 && value <= 1;
const isCount = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);
const isOneOf = (value: unknown, values: readonly string[]) =>
  typeof value === "string" && values.includes(value);
const ANSWER_VALUES = [
  "not_yet",
  "ad_hoc",
  "consistent",
  "reviewed",
  "unknown",
  "not_applicable",
];
const CONTROL_IDS = ["deadline", "mfa", "ai_review", "client_funds"];
const CONTROL_STATUSES = ["yes", "no", "unknown", "not_applicable"];

function validContext(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isOneOf(value.stage, ["prelaunch", "new", "established"]) &&
    isString(value.practiceArea) &&
    isString(value.jurisdiction) &&
    isOneOf(value.goal, [
      "more_clients",
      "better_conversion",
      "collect_cash",
      "less_admin",
      "sustainable_practice",
    ]) &&
    isOneOf(value.feeModel, [
      "hourly",
      "flat",
      "contingency",
      "subscription",
      "mixed",
      "other",
    ]) &&
    (value.capacityAdditionalMatters === null ||
      isFiniteNumber(value.capacityAdditionalMatters)) &&
    isOneOf(value.websiteStatus, ["has_site", "no_site", "unknown"]) &&
    (value.websiteUrl === undefined ||
      (isString(value.websiteUrl) &&
        normalizeWebsite(value.websiteUrl) !== null)) &&
    (value.usesAI === null || typeof value.usesAI === "boolean") &&
    (value.handlesClientFunds === null ||
      typeof value.handlesClientFunds === "boolean")
  );
}

/** Validate the issued snapshot's shape; never recalculate historical grades. */
function validAssessment(value: unknown): boolean {
  if (!isRecord(value) || validateRelease(value.releaseSnapshot).length > 0)
    return false;
  const release = value.releaseSnapshot as ReleaseSnapshot;
  if (
    value.releaseId !== release.id ||
    value.provisional !== true ||
    !validContext(value.contextSnapshot)
  )
    return false;
  if (
    !isString(value.overallNote) ||
    !isString(value.evidenceLabel) ||
    !isCoverage(value.coverage)
  )
    return false;
  if (value.overallScore !== null && !isScore(value.overallScore)) return false;
  if (
    !isRecord(value.answersSnapshot) ||
    !Object.values(value.answersSnapshot).every((answer) =>
      isOneOf(answer, ANSWER_VALUES),
    )
  )
    return false;
  if (
    !isRecord(value.controlsSnapshot) ||
    !Object.entries(value.controlsSnapshot).every(
      ([id, status]) =>
        CONTROL_IDS.includes(id) && isOneOf(status, CONTROL_STATUSES),
    )
  )
    return false;

  if (
    !Array.isArray(value.domains) ||
    value.domains.length !== DOMAIN_IDS.length
  )
    return false;
  const domainIds = new Set<string>();
  for (const domain of value.domains) {
    if (
      !isRecord(domain) ||
      !isOneOf(domain.id, DOMAIN_IDS) ||
      domainIds.has(domain.id as string)
    )
      return false;
    domainIds.add(domain.id as string);
    if (
      !isString(domain.title) ||
      !isString(domain.note) ||
      !isOneOf(domain.status, ["scored", "incomplete", "not_applicable"])
    )
      return false;
    if (
      !isCoverage(domain.coverage) ||
      !isCount(domain.answeredCount) ||
      !isCount(domain.applicableCount) ||
      domain.answeredCount > domain.applicableCount
    )
      return false;
    if (
      !isStringArray(domain.missingMandatory) ||
      !Array.isArray(domain.findings)
    )
      return false;
    if (
      domain.status === "scored"
        ? !isScore(domain.score)
        : domain.score !== null
    )
      return false;
    if (domain.status === "not_applicable") {
      if (
        domain.lowerBound !== null ||
        domain.upperBound !== null ||
        domain.applicableCount !== 0 ||
        domain.coverage !== 0
      )
        return false;
    } else if (
      !isScore(domain.lowerBound) ||
      !isScore(domain.upperBound) ||
      domain.lowerBound > domain.upperBound
    )
      return false;

    const expectedQuestions = release.questions.filter(
      (question) => question.domain === domain.id,
    );
    if (domain.findings.length !== expectedQuestions.length) return false;
    const expectedIds = new Set(
      expectedQuestions.map((question) => question.id),
    );
    const findingIds = new Set<string>();
    for (const finding of domain.findings) {
      if (
        !isRecord(finding) ||
        !isString(finding.questionId) ||
        !expectedIds.has(finding.questionId) ||
        findingIds.has(finding.questionId)
      )
        return false;
      findingIds.add(finding.questionId);
      if (
        !isString(finding.title) ||
        !isString(finding.note) ||
        !isOneOf(finding.answer, ANSWER_VALUES)
      )
        return false;
      if (finding.points !== null && !isScore(finding.points)) return false;
      if (
        !isFiniteNumber(finding.weight) ||
        finding.weight < 0 ||
        typeof finding.applicable !== "boolean" ||
        typeof finding.mandatory !== "boolean"
      )
        return false;
    }
    if (!domain.missingMandatory.every((id) => expectedIds.has(id)))
      return false;
  }

  if (
    !Array.isArray(value.controls) ||
    value.controls.length !== CONTROL_IDS.length
  )
    return false;
  const controlIds = new Set<string>();
  for (const control of value.controls) {
    if (
      !isRecord(control) ||
      !isString(control.id) ||
      !CONTROL_IDS.includes(control.id) ||
      controlIds.has(control.id)
    )
      return false;
    controlIds.add(control.id);
    if (
      !isString(control.title) ||
      !isString(control.note) ||
      typeof control.applicable !== "boolean" ||
      !isOneOf(control.status, CONTROL_STATUSES)
    )
      return false;
  }

  if (
    !Array.isArray(value.actions) ||
    value.actions.length > release.actions.length
  )
    return false;
  // Reuse the published action schema; extra result fields are checked below.
  if (validateRelease({ ...release, actions: value.actions }).length > 0)
    return false;
  const allowedActions = new Set(release.actions.map((action) => action.id));
  for (const action of value.actions) {
    if (
      !isRecord(action) ||
      !isString(action.id) ||
      !allowedActions.has(action.id)
    )
      return false;
    if (
      !isOneOf(action.priority, ["high", "medium", "low"]) ||
      !isStringArray(action.priorityReasons) ||
      action.priorityReasons.length === 0
    )
      return false;
  }
  return true;
}

export function parseStore(raw: string | null): PreviewStore | null {
  if (!raw || raw.length > 4_000_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    const v = value;
    if (
      v.schema !== 1 ||
      !v.activeRelease ||
      validateRelease(v.activeRelease).length > 0
    )
      return null;
    if (
      !Array.isArray(v.releaseHistory) ||
      v.releaseHistory.length > 100 ||
      v.releaseHistory.some((r) => validateRelease(r).length > 0)
    )
      return null;
    if (!Array.isArray(v.assessments) || v.assessments.length > 40) return null;
    const assessmentIds = new Set<string>();
    for (const entry of v.assessments) {
      if (
        !isRecord(entry) ||
        !isString(entry.id) ||
        !entry.id.trim() ||
        assessmentIds.has(entry.id) ||
        !isString(entry.label) ||
        typeof entry.isSample !== "boolean"
      )
        return null;
      if (!isString(entry.practiceId) || !entry.practiceId.trim()) return null;
      if (
        entry.baselineId !== undefined &&
        (!isString(entry.baselineId) ||
          !entry.baselineId.trim() ||
          entry.baselineId === entry.id)
      )
        return null;
      assessmentIds.add(entry.id);
      if (
        !isString(entry.createdAt) ||
        !Number.isFinite(Date.parse(entry.createdAt)) ||
        !validAssessment(entry.assessment)
      )
        return null;
    }
    // A baseline may age out of the bounded device history. Where it remains,
    // it must refer to the same practice and the same sample/real-data kind.
    const savedAssessments = v.assessments as SavedAssessment[];
    for (const entry of savedAssessments) {
      const baseline = entry.baselineId
        ? savedAssessments.find((saved) => saved.id === entry.baselineId)
        : undefined;
      if (
        baseline &&
        (baseline.practiceId !== entry.practiceId ||
          baseline.isSample !== entry.isSample)
      )
        return null;
    }
    if (
      !isRecord(v.actionStates) ||
      Object.values(v.actionStates).some(
        (state) => !isOneOf(state, ["todo", "done", "deferred"]),
      )
    )
      return null;
    if (
      !isRecord(v.preferences) ||
      ["reminders", "marketing", "benchmarking", "leaderboard"].some(
        (key) =>
          typeof (v.preferences as Record<string, unknown>)[key] !== "boolean",
      )
    )
      return null;
    return v as unknown as PreviewStore;
  } catch {
    return null;
  }
}

export function normalizeWebsite(input: string): string | null {
  try {
    const trimmed = input.trim();
    if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
    const scheme = trimmed.match(/^([a-z][a-z\d+.-]*):/i)?.[1];
    const bareHostWithPort = /^[^\s/:]+\.[^\s/:]+:\d+(?:[/?#]|$)/.test(trimmed);
    if (scheme && !/^https?$/i.test(scheme) && !bareHostWithPort) return null;
    const url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    if (
      !["https:", "http:"].includes(url.protocol) ||
      !url.hostname.includes(".") ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
