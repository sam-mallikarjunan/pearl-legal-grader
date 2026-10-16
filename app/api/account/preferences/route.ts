import {
  requireAccount,
  guardAccountMutation,
} from "../../../../lib/server/account-auth";
import {
  accountBody,
  accountRouteError,
  ACCOUNT_HEADERS,
} from "../../../../lib/server/account-http";
import {
  readAccountPreferences,
  updateAccountPreferences,
} from "../../../../lib/server/account-store";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireAccount(request);
    return Response.json(
      { preferences: await readAccountPreferences(user.id) },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return accountRouteError(error);
  }
}
export async function PATCH(request: Request) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    const preferences = await updateAccountPreferences(
      user.id,
      await accountBody(request, 3000),
    );
    return Response.json({ preferences }, { headers: ACCOUNT_HEADERS });
  } catch (error) {
    return accountRouteError(error);
  }
}
