import {
  requireOperator,
  guardAccountMutation,
  boundedAccountBody,
  accountErrorResponse,
} from "../../../../../../lib/server/account-auth";
import { ACCOUNT_HEADERS } from "../../../../../../lib/server/account-http";
import {
  leadRoutingStore,
  LeadRoutingError,
  leadRoutingErrorResponse,
} from "../../../../../../lib/server/lead-routing-store";
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
        detail: await leadRoutingStore().viewContact(
          user.id,
          id,
          await boundedAccountBody(request, 1000),
        ),
      },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return error instanceof LeadRoutingError
      ? leadRoutingErrorResponse(error)
      : accountErrorResponse(error);
  }
}
