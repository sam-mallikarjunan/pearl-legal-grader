import { practiceBenchmarkSummary } from "../../../lib/practice-benchmarks";
import { practiceBenchmarkStore } from "../../../lib/server/practice-benchmark-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Fixed catalogue only. No query-time slices, identifiers, raw answers or small counts. */
export async function GET(request: Request) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };
  if (new URL(request.url).search)
    return Response.json(
      {
        code: "filters_unavailable",
        message:
          "Only the fixed, privacy-checked practice benchmark catalogue is available.",
      },
      { status: 400, headers },
    );
  try {
    return Response.json(await practiceBenchmarkStore().summary(), { headers });
  } catch {
    return Response.json(
      {
        ...practiceBenchmarkSummary(
          { observations: [], incomplete: true },
          null,
        ),
        status: "unavailable",
        title: "Practice comparisons are temporarily unavailable",
        explanation:
          "Participant evidence could not be checked just now. No peer statistic is published. Unknown is not zero; the separately sourced industry references remain available.",
      },
      { headers },
    );
  }
}
