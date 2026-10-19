import { DOMAIN_IDS, type DomainId } from "./types";
import {
  RESEARCH_FRESHNESS_DAYS,
  RESEARCH_MIN_COHORT,
  type ResearchRow,
} from "./research";

export const PUBLIC_BENCHMARK_METHODOLOGY = "consented-descriptives-v1";
export interface PublicBenchmarkSummary {
  status: "insufficient_data" | "descriptive";
  title: string;
  methodologyVersion: string;
  releaseId: string | null;
  minimumCohort: number;
  freshnessDays: number;
  cohortSizeBand: string | null;
  domains: {
    id: DomainId;
    status: "suppressed" | "descriptive";
    medianScore: number | null;
    unit: "rubric points out of 100";
    cohortSizeBand: string | null;
  }[];
  explanation: string;
  limitations: string[];
}
const countBand = (count: number) =>
  `${Math.floor(count / 10) * 10}–${Math.floor(count / 10) * 10 + 9}`;
const validScore = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;

/** Single unsliced publication. Never serialize source rows, identifiers, exclusions, or small counts. */
export function publicBenchmarkSummary(
  rows: ResearchRow[],
  activeReleaseId: string | null,
  truncated = false,
): PublicBenchmarkSummary {
  const suppressed: PublicBenchmarkSummary = {
    status: "insufficient_data",
    title: "Comparable contributor data is still being built",
    methodologyVersion: PUBLIC_BENCHMARK_METHODOLOGY,
    releaseId: activeReleaseId,
    minimumCohort: RESEARCH_MIN_COHORT,
    freshnessDays: RESEARCH_FRESHNESS_DAYS,
    cohortSizeBand: null,
    domains: [],
    explanation:
      "A comparable group is not ready to publish. At least 30 distinct consenting workspaces with recent, compatible evidence are needed. Missing data is not a score of zero.",
    limitations: [
      "Self-selected, unverified workspaces; not a representative sample of law firms.",
      "This whole cohort mixes practice stages, fee models, and goals. It is not a matched peer group.",
      "Owner-reported operational readiness under one rubric, not legal skill, client outcomes, or conversion percentages.",
      "Latest eligible assessment per workspace, current research permission, same published release, within 90 days, and at least 80% assessment evidence coverage.",
      "No public subgroup filters. Counts are shown in bands of ten; medians are rounded to five rubric points. Each displayed metric needs at least 30 known scores.",
      "These descriptive summaries do not establish causation, independently verify firms, or automatically change grading weights.",
    ],
  };
  if (
    truncated ||
    !activeReleaseId ||
    rows.some(
      (row) =>
        row.releaseId !== activeReleaseId ||
        !row.workspacePseudonym ||
        !Array.isArray(row.domains),
    )
  )
    return suppressed;
  const unique = new Map<string, ResearchRow>();
  for (const row of rows) {
    if (
      row.domains.some(
        (domain) =>
          !DOMAIN_IDS.includes(domain.id) ||
          !(domain.score === null || validScore(domain.score)) ||
          !Number.isFinite(domain.coverage) ||
          domain.coverage < 0 ||
          domain.coverage > 1,
      ) ||
      new Set(row.domains.map((d) => d.id)).size !== row.domains.length
    )
      return suppressed;
    // Conflicting duplicate observations are ambiguous; do not choose one for public data.
    if (unique.has(row.workspacePseudonym)) return suppressed;
    unique.set(row.workspacePseudonym, row);
  }
  const members = [...unique.values()];
  if (members.length < RESEARCH_MIN_COHORT) return suppressed;
  const domains = DOMAIN_IDS.map((id) => {
    const scores = members
      .map((row) => row.domains.find((d) => d.id === id)?.score)
      .filter(validScore)
      .sort((a, b) => a - b);
    const enough = scores.length >= RESEARCH_MIN_COHORT;
    const middle = Math.floor(scores.length / 2);
    const median = enough
      ? scores.length % 2
        ? scores[middle]
        : (scores[middle - 1] + scores[middle]) / 2
      : null;
    return {
      id,
      status: enough ? ("descriptive" as const) : ("suppressed" as const),
      medianScore: median === null ? null : Math.round(median / 5) * 5,
      unit: "rubric points out of 100" as const,
      cohortSizeBand: enough ? countBand(scores.length) : null,
    };
  });
  if (!domains.some((domain) => domain.status === "descriptive"))
    return suppressed;
  return {
    ...suppressed,
    status: "descriptive",
    title: "Contributor readiness, with limits",
    cohortSizeBand: countBand(members.length),
    domains,
    explanation:
      "Rounded descriptive medians from consenting workspaces using this scoring release. They describe participants only; no percentile or legal-quality rank is assigned.",
  };
}
