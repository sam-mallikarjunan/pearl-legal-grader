import {
  requireAccount,
  guardAccountMutation,
} from "../../../../../../lib/server/account-auth";
import {
  accountBody,
  accountRouteError,
  ACCOUNT_HEADERS,
} from "../../../../../../lib/server/account-http";
import { updateAccountAction } from "../../../../../../lib/server/account-store";
export const runtime = "nodejs";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    const progress = await updateAccountAction(
      user.id,
      (await context.params).id,
      await accountBody(request, 5000),
    );
    return Response.json({ progress }, { headers: ACCOUNT_HEADERS });
  } catch (error) {
    return accountRouteError(error);
  }
}
