import {
  accountErrorResponse,
  boundedAccountBody,
  guardAccountMutation,
  requireOperator,
} from "../../../../../lib/server/account-auth";
import {
  researchErrorResponse,
  ResearchServiceError,
  researchStore,
} from "../../../../../lib/server/research-store";
import { ACCOUNT_HEADERS } from "../../../../../lib/server/account-http";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardAccountMutation(request);
    const user = await requireOperator(request);
    const { id } = await context.params;
    return Response.json(
      {
        request: await researchStore().updateRequest(
          user.id,
          id,
          await boundedAccountBody(request, 2000),
        ),
      },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return error instanceof ResearchServiceError
      ? researchErrorResponse(error)
      : accountErrorResponse(error);
  }
}
