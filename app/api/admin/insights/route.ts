import {
  accountErrorResponse,
  requireOperator,
} from "../../../../lib/server/account-auth";
import {
  researchErrorResponse,
  ResearchServiceError,
  researchStore,
} from "../../../../lib/server/research-store";
import { ACCOUNT_HEADERS } from "../../../../lib/server/account-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireOperator(request);
    const store = researchStore();
    const [dataset, counts, requests] = await Promise.all([
      store.dataset(),
      store.counts(),
      store.adminRequests(),
    ]);
    return Response.json(
      {
        research: dataset.summary,
        activeReleaseId: dataset.activeReleaseId,
        counts,
        requests,
      },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return error instanceof ResearchServiceError
      ? researchErrorResponse(error)
      : accountErrorResponse(error);
  }
}
