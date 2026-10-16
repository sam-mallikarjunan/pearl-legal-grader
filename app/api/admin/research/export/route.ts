import {
  accountErrorResponse,
  requireOperator,
} from "../../../../../lib/server/account-auth";
import {
  researchCsv,
  researchErrorResponse,
  ResearchServiceError,
  researchStore,
  RESEARCH_LIMITATIONS,
  RESEARCH_POLICY_VERSION,
} from "../../../../../lib/server/research-store";
import { ACCOUNT_HEADERS } from "../../../../../lib/server/account-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireOperator(request);
    const store = researchStore();
    const dataset = await store.dataset();
    await store.recordExport(
      user.id,
      "research",
      dataset.rows.length,
      dataset.activeReleaseId,
    );
    if (new URL(request.url).searchParams.get("format") === "json")
      return Response.json(
        {
          policyVersion: RESEARCH_POLICY_VERSION,
          limitations: RESEARCH_LIMITATIONS,
          releaseId: dataset.activeReleaseId,
          exportedAt: new Date().toISOString(),
          truncated: dataset.truncated,
          rows: dataset.rows,
        },
        {
          headers: {
            ...ACCOUNT_HEADERS,
            "Content-Disposition":
              "attachment; filename=pearl-consented-workspace-research.json",
          },
        },
      );
    return new Response(researchCsv(dataset.rows), {
      headers: {
        ...ACCOUNT_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          "attachment; filename=pearl-consented-workspace-research.csv",
        "X-Research-Policy": RESEARCH_POLICY_VERSION,
        "X-Dataset-Truncated": String(dataset.truncated),
      },
    });
  } catch (error) {
    return error instanceof ResearchServiceError
      ? researchErrorResponse(error)
      : accountErrorResponse(error);
  }
}
