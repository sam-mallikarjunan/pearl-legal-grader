import { DEFAULT_RELEASE } from "./catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "./demo";
import { assessPractice, validateRelease } from "./scoring";
import type {
  Answers,
  DomainId,
  PracticeContext,
  ReleaseSnapshot,
} from "./types";

export interface ConfigRelease {
  release: ReleaseSnapshot;
  contentHash: string;
  publishedAt: string | null;
  source: "published" | "default";
  available: true;
}
export interface ConfigHistoryEntry extends ConfigRelease {
  reason: string;
  parentId: string | null;
}
export interface CalibrationComparison {
  id: string;
  label: string;
  before: number | null;
  after: number | null;
  coverageBefore: number;
  coverageAfter: number;
  domainChanges: {
    id: DomainId;
    before: number | null;
    after: number | null;
  }[];
  actionsAdded: string[];
  actionsRemoved: string[];
}

/** Stable encoding makes hashes independent of JSON object key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** Publishing supports the existing typed rule language, never executable code. */
export function validatePublishedConfig(value: unknown): string[] {
  const errors = validateRelease(value);
  if (errors.length) return errors;
  const release = value as ReleaseSnapshot;
  if (canonicalJson(release).length > 200_000)
    errors.push("The release is too large.");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(release.id))
    errors.push("The release ID is invalid.");
  if (release.label.length > 150 || release.rubricNote.length > 2000)
    errors.push("Release text exceeds the supported length.");
  if (release.questions.length > 100 || release.actions.length > 100)
    errors.push("At most 100 questions and 100 actions are supported.");
  for (const domain of release.domains) {
    if (!/^#[a-fA-F0-9]{6}$/.test(domain.color))
      errors.push(`${domain.id} needs a six-digit color.`);
    if (
      domain.title.length > 120 ||
      domain.description.length > 1000 ||
      domain.weight > 100
    )
      errors.push(`${domain.id} exceeds the supported text or weight range.`);
  }
  for (const question of release.questions) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(question.id))
      errors.push("A question ID is invalid.");
    if (
      question.title.length > 300 ||
      question.help.length > 2000 ||
      question.weight > 100
    )
      errors.push(`${question.id} exceeds the supported text or weight range.`);
    if (
      !Array.isArray(question.catalogueIds) ||
      question.catalogueIds.length > 20 ||
      question.catalogueIds.some(
        (id) => typeof id !== "string" || !/^GR-\d{3}$/.test(id),
      )
    )
      errors.push(`${question.id} has an invalid catalogue reference.`);
    if (question.options.some((option) => option.label.length > 500))
      errors.push(`${question.id} has an answer label that is too long.`);
  }
  for (const action of release.actions) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(action.id))
      errors.push("An action ID is invalid.");
    if (
      action.title.length > 200 ||
      action.summary.length > 2000 ||
      action.steps.length > 20 ||
      action.steps.some((step) => step.length > 1500) ||
      action.definitionOfDone.length > 2000 ||
      action.verification.length > 2000 ||
      action.effort.length > 150
    )
      errors.push(`${action.id} exceeds the supported text length.`);
  }
  return errors;
}

const base = (patch: Partial<PracticeContext> = {}): PracticeContext => ({
  ...SAMPLE_CONTEXT,
  ...patch,
});
const standard = Object.fromEntries(
  DEFAULT_RELEASE.questions.map((q) => [q.id, "consistent"]),
) as Answers;
const examples = [
  {
    id: "juniper",
    label: "Mixed-fee established solo",
    context: base(),
    answers: SAMPLE_ANSWERS,
  },
  {
    id: "prelaunch",
    label: "Prelaunch, no website",
    context: base({
      stage: "prelaunch",
      websiteStatus: "no_site",
      websiteUrl: undefined,
      usesAI: false,
      handlesClientFunds: false,
    }),
    answers: {},
  },
  {
    id: "overloaded",
    label: "At capacity, seeking less administration",
    context: base({ capacityAdditionalMatters: 0, goal: "less_admin" }),
    answers: {
      ...standard,
      "operations-2": "not_yet",
      "independence-1": "ad_hoc",
    } as Answers,
  },
  {
    id: "contingency",
    label: "Contingency, no invoiced fees",
    context: base({ feeModel: "contingency", handlesClientFunds: false }),
    answers: {
      ...standard,
      "cash-3": "unknown",
      "cash-4": "not_yet",
    } as Answers,
  },
  {
    id: "unknown",
    label: "All operating answers unknown",
    context: base(),
    answers: {},
  },
  {
    id: "no-process",
    label: "Processes not yet in place",
    context: base(),
    answers: Object.fromEntries(
      DEFAULT_RELEASE.questions.map((q) => [q.id, "not_yet"]),
    ) as Answers,
  },
];

/** Frozen fictional examples expose score, eligibility and action changes. */
export function compareConfiguration(
  before: ReleaseSnapshot,
  after: ReleaseSnapshot,
): CalibrationComparison[] {
  if (
    validatePublishedConfig(before).length ||
    validatePublishedConfig(after).length
  )
    return [];
  return examples.map((example) => {
    const input = {
      context: example.context,
      answers: example.answers,
      controls: SAMPLE_CONTROLS,
    };
    const old = assessPractice({ ...input, release: before });
    const next = assessPractice({ ...input, release: after });
    return {
      id: example.id,
      label: example.label,
      before: old.overallScore,
      after: next.overallScore,
      coverageBefore: old.coverage,
      coverageAfter: next.coverage,
      domainChanges: old.domains.map((domain) => ({
        id: domain.id,
        before: domain.score,
        after:
          next.domains.find((item) => item.id === domain.id)?.score ?? null,
      })),
      actionsAdded: next.actions
        .filter((action) => !old.actions.some((item) => item.id === action.id))
        .map((action) => action.title),
      actionsRemoved: old.actions
        .filter((action) => !next.actions.some((item) => item.id === action.id))
        .map((action) => action.title),
    };
  });
}
