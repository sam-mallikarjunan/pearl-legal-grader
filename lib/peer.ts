import type { SavedAssessment } from "./storage";

export const PEER_METHODOLOGY_VERSION = "peer-context-v1";

/** No distribution is inferred from public scans or fictional samples. */
export function benchmarkAvailability() {
  return {
    status: "insufficient_data" as const,
    methodologyVersion: PEER_METHODOLOGY_VERSION,
    title: "Community comparisons need enough evidence",
    explanation:
      "There is no published, reviewed comparison group yet. Your assessment is useful on its own; no peer rank or percentile is assigned.",
    eligibility: [
      "Explicit, separate permission to contribute private assessment data",
      "Distinct consenting workspaces with compatible practice context; accounts do not verify law firms",
      "The same scoring version, scope and evidence definitions",
      "Adequate evidence coverage and recent observations",
      "Enough participants plus privacy and concentration review",
      "A disclosed method, source dates and clear limits on interpretation",
    ],
    boundaries: [
      "Owner reports and observed website findings stay separate",
      "No public ranking of legal skill, competence or client outcomes",
      "No bonus for buying a product, sharing data or joining a leaderboard",
      "Private benchmarking permission does not authorize named publication",
    ],
    publicationEnabled: false,
  };
}

export interface PrivateSharePreview {
  privateOnly: true;
  title: string;
  scope: "Observed website checks" | "Owner-reported readiness";
  score: number | null;
  coverage: number;
  asOf: string;
  releaseLabel: string;
  evidenceNote: string;
  publicationNote: string;
}

/** A private draft contains no URL, contact detail, private answers or controls. */
export function privateSharePreview(
  entry: SavedAssessment,
): PrivateSharePreview | null {
  if (entry.isSample) return null;
  const scan = entry.websiteScan;
  if (scan && scan.score !== null) {
    return {
      privateOnly: true,
      title: "Public website snapshot",
      scope: "Observed website checks",
      score: scan.score,
      coverage: scan.coverage / 100,
      asOf: scan.completedAt,
      releaseLabel: scan.rubricVersion,
      evidenceNote:
        "Bounded public-page and mobile laboratory checks. Coverage and scores from different methods or scopes are not directly comparable.",
      publicationNote:
        "Private preview only. No public link, badge or leaderboard entry has been created.",
    };
  }
  return {
    privateOnly: true,
    title: "Building a practice that works for me",
    scope: "Owner-reported readiness",
    score: entry.assessment.overallScore,
    coverage: entry.assessment.coverage,
    asOf: entry.createdAt,
    releaseLabel: entry.assessment.releaseSnapshot.label,
    evidenceNote:
      "Based on the owner’s answers under a provisional rubric. This is not independently verified or a whole-practice certification.",
    publicationNote:
      "Private preview only. No public link, badge or leaderboard entry has been created.",
  };
}
