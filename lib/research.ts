import {
  parseAccountReport,
  accountRecord,
  accountUuid,
} from "./account/validation";
import { assessPractice } from "./scoring";
import {
  ACTION_OUTCOMES,
  isActionProgress,
  type ActionProgress,
} from "./storage";
import {
  DOMAIN_IDS,
  type FeeModel,
  type Goal,
  type PracticeStage,
  type ReleaseSnapshot,
} from "./types";

export const RESEARCH_POLICY_VERSION = "consented-workspace-research-v1";
export const RESEARCH_MIN_COHORT = 30;
export const RESEARCH_FRESHNESS_DAYS = 90;
export const RESEARCH_LIMITATIONS =
  "These are consenting, unverified workspaces, not verified law firms or a representative industry sample. Operating practices and outcomes are owner-reported. Associations do not establish causation. Public peer rankings remain unavailable.";
export interface ResearchCandidate {
  workspaceId: string;
  benchmarking: boolean;
  report: unknown;
  progress: { actionId: string; details?: ActionProgress | null }[];
}
export interface ResearchRow {
  workspacePseudonym: string;
  stage: PracticeStage;
  feeModel: FeeModel;
  goal: Goal;
  releaseId: string;
  assessmentMonth: string;
  domains: {
    id: (typeof DOMAIN_IDS)[number];
    score: number | null;
    coverage: number;
  }[];
  reportedOutcomes: Record<(typeof ACTION_OUTCOMES)[number], number>;
}
export type ResearchIneligibleReason =
  | "no_consent"
  | "invalid"
  | "sample"
  | "different_release"
  | "stale"
  | "insufficient_evidence";
export type ResearchProjection =
  | { eligible: true; row: ResearchRow; assessedAt: string }
  | { eligible: false; reason: ResearchIneligibleReason };

/** Reproduce approved scores from saved observations; never export supplied scores directly. */
export function projectResearchCandidate(
  candidate: ResearchCandidate,
  release: ReleaseSnapshot,
  pseudonym: (id: string) => string,
  now = new Date(),
): ResearchProjection {
  if (candidate.benchmarking !== true)
    return { eligible: false, reason: "no_consent" };
  if (!accountUuid(candidate.workspaceId) || !accountRecord(candidate.report))
    return { eligible: false, reason: "invalid" };
  if (candidate.report.isSample !== false)
    return { eligible: false, reason: "sample" };
  if (
    !accountRecord(candidate.report.assessment) ||
    candidate.report.assessment.releaseId !== release.id
  )
    return { eligible: false, reason: "different_release" };
  try {
    const { report } = parseAccountReport(
      { report: candidate.report },
      release,
    );
    const created = Date.parse(report.createdAt);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(report.createdAt) ||
      new Date(created).toISOString() !== report.createdAt ||
      created > now.getTime() + 300_000 ||
      created < now.getTime() - RESEARCH_FRESHNESS_DAYS * 86_400_000
    )
      return { eligible: false, reason: "stale" };
    const computed = assessPractice({
      context: report.assessment.contextSnapshot,
      answers: report.assessment.answersSnapshot,
      controls: report.assessment.controlsSnapshot,
      release,
    });
    if (
      computed.coverage < 0.8 ||
      computed.overallScore === null ||
      computed.domains.some((domain) => domain.status === "incomplete")
    )
      return { eligible: false, reason: "insufficient_evidence" };
    const outcomes: ResearchRow["reportedOutcomes"] = {
      improved: 0,
      no_change: 0,
      worse: 0,
      unsure: 0,
    };
    const allowed = new Set(computed.actions.map((action) => action.id));
    const seen = new Set<string>();
    for (const progress of candidate.progress) {
      if (
        !allowed.has(progress.actionId) ||
        seen.has(progress.actionId) ||
        !isActionProgress(progress.details)
      )
        continue;
      seen.add(progress.actionId);
      const outcome = progress.details.outcome;
      if (
        outcome &&
        Date.parse(outcome.recordedAt) >= created &&
        Date.parse(outcome.recordedAt) <= now.getTime() + 300_000
      )
        outcomes[outcome.status] += 1;
    }
    return {
      eligible: true,
      assessedAt: report.createdAt,
      row: {
        workspacePseudonym: pseudonym(candidate.workspaceId),
        stage: computed.contextSnapshot.stage,
        feeModel: computed.contextSnapshot.feeModel,
        goal: computed.contextSnapshot.goal,
        releaseId: release.id,
        assessmentMonth: report.createdAt.slice(0, 7),
        domains: computed.domains.map((domain) => ({
          id: domain.id,
          score: domain.score === null ? null : Math.round(domain.score),
          coverage: Math.round(domain.coverage * 100) / 100,
        })),
        reportedOutcomes: outcomes,
      },
    };
  } catch {
    return { eligible: false, reason: "invalid" };
  }
}

/** One eligible observation per workspace; repeated scans never increase cohort size. */
export function researchDataset(
  candidates: ResearchCandidate[],
  release: ReleaseSnapshot,
  pseudonym: (id: string) => string,
  now = new Date(),
) {
  const latest = new Map<string, { row: ResearchRow; assessedAt: string }>();
  const excluded: Partial<Record<ResearchIneligibleReason, number>> = {};
  for (const candidate of candidates) {
    const projected = projectResearchCandidate(
      candidate,
      release,
      pseudonym,
      now,
    );
    if (!projected.eligible) {
      excluded[projected.reason] = (excluded[projected.reason] ?? 0) + 1;
      continue;
    }
    const previous = latest.get(candidate.workspaceId);
    if (!previous || projected.assessedAt > previous.assessedAt)
      latest.set(candidate.workspaceId, projected);
  }
  return {
    rows: [...latest.values()]
      .map((item) => item.row)
      .sort((a, b) => a.workspacePseudonym.localeCompare(b.workspacePseudonym)),
    excluded,
  };
}

export function researchSummary(rows: ResearchRow[], truncated = false) {
  rows = [
    ...new Map(rows.map((row) => [row.workspacePseudonym, row])).values(),
  ];
  const mixedReleases = new Set(rows.map((row) => row.releaseId)).size > 1;
  const cohort = (members: ResearchRow[]) => ({
    workspaces: members.length,
    status:
      !truncated && members.length >= RESEARCH_MIN_COHORT
        ? ("descriptive" as const)
        : ("suppressed" as const),
    domains:
      !truncated && members.length >= RESEARCH_MIN_COHORT
        ? DOMAIN_IDS.map((id) => {
            const scores = members
              .map(
                (row) => row.domains.find((domain) => domain.id === id)?.score,
              )
              .filter((score): score is number => typeof score === "number")
              .sort((a, b) => a - b);
            return {
              id,
              workspaces: scores.length,
              median:
                scores.length >= RESEARCH_MIN_COHORT
                  ? scores.length % 2
                    ? scores[Math.floor(scores.length / 2)]
                    : (scores[scores.length / 2 - 1] +
                        scores[scores.length / 2]) /
                      2
                  : null,
            };
          })
        : [],
  });
  const groups = new Map<string, ResearchRow[]>();
  for (const row of rows) {
    const key = [row.releaseId, row.stage, row.feeModel, row.goal].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return {
    policyVersion: RESEARCH_POLICY_VERSION,
    limitations: RESEARCH_LIMITATIONS,
    minimumCohort: RESEARCH_MIN_COHORT,
    freshnessDays: RESEARCH_FRESHNESS_DAYS,
    eligibleWorkspaces: rows.length,
    truncated,
    overall: mixedReleases
      ? { workspaces: rows.length, status: "suppressed" as const, domains: [] }
      : cohort(rows),
    cohorts: [...groups].map(([key, members]) => ({ key, ...cohort(members) })),
  };
}

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function researchCsv(rows: ResearchRow[]): string {
  const headers = [
    "workspace_pseudonym",
    "stage",
    "fee_model",
    "goal",
    "release_id",
    "assessment_month",
    ...DOMAIN_IDS.flatMap((id) => [`${id}_score`, `${id}_coverage_percent`]),
    ...ACTION_OUTCOMES.map((status) => `owner_reported_outcome_${status}`),
  ];
  return (
    [
      headers.map(csvCell).join(","),
      ...rows.map((row) =>
        [
          row.workspacePseudonym,
          row.stage,
          row.feeModel,
          row.goal,
          row.releaseId,
          row.assessmentMonth,
          ...DOMAIN_IDS.flatMap((id) => {
            const domain = row.domains.find((item) => item.id === id);
            return [
              domain?.score,
              domain ? Math.round(domain.coverage * 100) : null,
            ];
          }),
          ...ACTION_OUTCOMES.map((status) => row.reportedOutcomes[status]),
        ]
          .map(csvCell)
          .join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
