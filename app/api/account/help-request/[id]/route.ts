import {
  accountErrorResponse,
  guardAccountMutation,
  requireAccount,
} from "../../../../../lib/server/account-auth";
import {
  researchErrorResponse,
  ResearchServiceError,
  researchStore,
} from "../../../../../lib/server/research-store";
import { ACCOUNT_HEADERS } from "../../../../../lib/server/account-http";
export const dynamic = "force-dynamic";
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    const { id } = await context.params;
    return Response.json(
      { request: await researchStore().withdrawRequest(user.id, id) },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return error instanceof ResearchServiceError
      ? researchErrorResponse(error)
      : accountErrorResponse(error);
  }
}
