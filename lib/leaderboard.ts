import {
  accountRecord,
  accountUuid,
  parseAccountReport,
  validRevision,
} from "./account/validation";
import { assessPractice } from "./scoring";
import type { FeeModel, PracticeStage, ReleaseSnapshot } from "./types";

export const LEADERBOARD_POLICY_VERSION = "anonymous-operating-readiness-v1";
export const LEADERBOARD_CONSENT_TEXT =
  "Publish my selected report's owner-reported operating-readiness score, evidence coverage and broad stage/fee-model cohort under a generated anonymous alias on the public leaderboard. My name, firm, location, website and answers stay private. I can withdraw at any time. Publishing does not change my grade.";
export const LEADERBOARD_MIN_COHORT = 10;
export const LEADERBOARD_FRESHNESS_DAYS = 90;
export const LEADERBOARD_LIMITATIONS =
  "Owner-reported operating readiness, not legal quality, licensing, compliance or verified business results. Email verification does not verify a law license or an independent firm. These self-selected workspaces are not a representative industry sample. No peer percentiles are estimated here.";
export const LEADERBOARD_STAGES: Record<PracticeStage, string> = {
  prelaunch: "Preparing to launch",
  new: "New practice",
  established: "Established practice",
};
export const LEADERBOARD_FEES: Record<FeeModel, string> = {
  hourly: "Hourly fees",
  flat: "Flat fees",
  contingency: "Contingency fees",
  subscription: "Subscription fees",
  mixed: "Mixed fees",
  other: "Other fees",
};
export interface LeaderboardEnrollment {
  published: boolean;
  alias: string | null;
  reportId: string | null;
  revision: number;
  updatedAt: string | null;
}
export interface LeaderboardCandidate {
  workspaceId: string;
  alias: string;
  published: boolean;
  consentVersion: string;
  revision: number;
  reportId: string;
  report: unknown;
}
export interface LeaderboardEntry {
  alias: string;
  score: number;
  coveragePercent: number;
  rank: number;
}
export interface LeaderboardCohort {
  stage: PracticeStage;
  feeModel: FeeModel;
  label: string;
  status: "forming" | "ranked";
  entryCount: number | null;
  entries: LeaderboardEntry[];
}
export interface PublicLeaderboard {
  policyVersion: string;
  releaseId: string;
  releaseLabel: string;
  minimumCohort: number;
  freshnessDays: number;
  limitations: string;
  truncated: boolean;
  cohorts: LeaderboardCohort[];
}
export type LeaderboardEligibility =
  | {
      eligible: true;
      score: number;
      coverage: number;
      stage: PracticeStage;
      feeModel: FeeModel;
      createdAt: string;
      cohortLabel: string;
    }
  | {
      eligible: false;
      reason:
        | "sample"
        | "different_release"
        | "stale"
        | "insufficient_evidence"
        | "invalid";
    };
export function leaderboardAliasValid(value: unknown): value is string {
  return typeof value === "string" && /^Practice-[A-F0-9]{12}$/.test(value);
}
export function leaderboardEligibility(
  value: unknown,
  release: ReleaseSnapshot,
  now = new Date(),
): LeaderboardEligibility {
  if (!accountRecord(value)) return { eligible: false, reason: "invalid" };
  if (value.isSample !== false) return { eligible: false, reason: "sample" };
  if (
    !accountRecord(value.assessment) ||
    value.assessment.releaseId !== release.id
  )
    return { eligible: false, reason: "different_release" };
  try {
    const { report } = parseAccountReport({ report: value }, release);
    const created = Date.parse(report.createdAt);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(report.createdAt) ||
      new Date(created).toISOString() !== report.createdAt ||
      created > now.getTime() + 300_000 ||
      created < now.getTime() - LEADERBOARD_FRESHNESS_DAYS * 86_400_000
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
      computed.domains.some((d) => d.status === "incomplete")
    )
      return { eligible: false, reason: "insufficient_evidence" };
    const { stage, feeModel } = computed.contextSnapshot;
    return {
      eligible: true,
      score: Math.round(computed.overallScore),
      coverage: computed.coverage,
      stage,
      feeModel,
      createdAt: report.createdAt,
      cohortLabel: `${LEADERBOARD_STAGES[stage]} · ${LEADERBOARD_FEES[feeModel]}`,
    };
  } catch {
    return { eligible: false, reason: "invalid" };
  }
}
export function parseLeaderboardPublish(
  body: unknown,
): { reportId: string; revision: number } | null {
  if (
    !accountRecord(body) ||
    Object.keys(body).some(
      (key) => !["reportId", "revision", "consent"].includes(key),
    ) ||
    body.consent !== true ||
    !accountUuid(body.reportId) ||
    !validRevision(body.revision)
  )
    return null;
  return { reportId: body.reportId, revision: body.revision };
}
/** No identifiers or freeform owner data pass this projection. Duplicate workspaces never increase cohort size. */
export function publicLeaderboard(
  candidates: LeaderboardCandidate[],
  release: ReleaseSnapshot,
  now = new Date(),
  truncated = false,
): PublicLeaderboard {
  const unique = new Map<string, LeaderboardCandidate>();
  const duplicates = new Set<string>();
  for (const c of candidates) {
    if (unique.has(c.workspaceId)) duplicates.add(c.workspaceId);
    unique.set(c.workspaceId, c);
  }
  const rows: {
    candidate: LeaderboardCandidate;
    eligibility: Extract<LeaderboardEligibility, { eligible: true }>;
  }[] = [];
  for (const [id, candidate] of unique) {
    if (
      duplicates.has(id) ||
      !accountUuid(id) ||
      !accountUuid(candidate.reportId) ||
      !validRevision(candidate.revision) ||
      !leaderboardAliasValid(candidate.alias) ||
      candidate.published !== true ||
      candidate.consentVersion !== LEADERBOARD_POLICY_VERSION
    )
      continue;
    const eligibility = leaderboardEligibility(candidate.report, release, now);
    if (eligibility.eligible) rows.push({ candidate, eligibility });
  }
  const aliases = new Set<string>();
  const duplicateAliases = new Set<string>();
  for (const { candidate } of rows) {
    if (aliases.has(candidate.alias)) duplicateAliases.add(candidate.alias);
    aliases.add(candidate.alias);
  }
  const cohorts: LeaderboardCohort[] = [];
  for (const stage of Object.keys(LEADERBOARD_STAGES) as PracticeStage[])
    for (const feeModel of Object.keys(LEADERBOARD_FEES) as FeeModel[]) {
      const members = rows
        .filter(
          (r) =>
            r.eligibility.stage === stage &&
            r.eligibility.feeModel === feeModel &&
            !duplicateAliases.has(r.candidate.alias),
        )
        .sort(
          (a, b) =>
            b.eligibility.score - a.eligibility.score ||
            a.candidate.alias.localeCompare(b.candidate.alias),
        );
      const ranked = !truncated && members.length >= LEADERBOARD_MIN_COHORT;
      let lastScore: number | null = null,
        rank = 0;
      cohorts.push({
        stage,
        feeModel,
        label: `${LEADERBOARD_STAGES[stage]} · ${LEADERBOARD_FEES[feeModel]}`,
        status: ranked ? "ranked" : "forming",
        entryCount: ranked ? members.length : null,
        entries: ranked
          ? members.map((r, index) => {
              if (r.eligibility.score !== lastScore) rank = index + 1;
              lastScore = r.eligibility.score;
              return {
                alias: r.candidate.alias,
                score: r.eligibility.score,
                coveragePercent: Math.round(r.eligibility.coverage * 100),
                rank,
              };
            })
          : [],
      });
    }
  return {
    policyVersion: LEADERBOARD_POLICY_VERSION,
    releaseId: release.id,
    releaseLabel: release.label,
    minimumCohort: LEADERBOARD_MIN_COHORT,
    freshnessDays: LEADERBOARD_FRESHNESS_DAYS,
    limitations: LEADERBOARD_LIMITATIONS,
    truncated,
    cohorts,
  };
}
