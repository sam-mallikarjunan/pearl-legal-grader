import {
  BENCHMARK_CATALOG_VERSION,
  BENCHMARK_REVIEWED_AT,
} from "../../../lib/benchmarks";
import { publicBenchmarkSummary } from "../../../lib/benchmarks-public";
import { researchStore } from "../../../lib/server/research-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fixed whole-cohort view only: no arbitrary slices, rows, pseudonyms, or small counts. */
export async function GET(request: Request) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };
  if (new URL(request.url).search)
    return Response.json(
      {
        code: "filters_unavailable",
        message: "Public cohort filters are unavailable.",
      },
      { status: 400, headers },
    );
  let summary = publicBenchmarkSummary([], null);
  try {
    const store = researchStore();
    // A private upper-bound check avoids loading source reports while a publishable cohort is impossible.
    const counts = await store.counts();
    if (counts.benchmarkingConsent >= summary.minimumCohort) {
      const dataset = await store.dataset();
      summary = publicBenchmarkSummary(
        dataset.rows,
        dataset.activeReleaseId,
        dataset.truncated,
      );
    }
  } catch {
    // Fail closed without revealing a count, row, identifier, or provider failure.
    summary = {
      ...summary,
      title: "Contributor comparisons are temporarily unavailable",
      explanation:
        "Contributor data could not be checked just now. No peer statistic is published. The industry references are still available; unavailable data is not a score of zero.",
    };
  }
  return Response.json(
    {
      ...summary,
      catalogVersion: BENCHMARK_CATALOG_VERSION,
      sourcesReviewedAt: BENCHMARK_REVIEWED_AT,
      publicationEnabled: summary.status === "descriptive",
    },
    {
      headers: {
        ...headers,
      },
    },
  );
}
