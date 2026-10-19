import {
  guardAccountMutation,
  requireOperator,
} from "../../../../lib/server/account-auth";
import {
  ACCOUNT_HEADERS,
  accountBody,
  accountRouteError,
} from "../../../../lib/server/account-http";
import {
  readNurtureOperations,
  setNurturePause,
} from "../../../../lib/server/nurture-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireOperator(request);
    return Response.json(await readNurtureOperations(), {
      headers: ACCOUNT_HEADERS,
    });
  } catch (error) {
    return accountRouteError(error);
  }
}
export async function PATCH(request: Request) {
  try {
    guardAccountMutation(request);
    const user = await requireOperator(request);
    return Response.json(
      await setNurturePause(user.id, await accountBody(request, 2000)),
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return accountRouteError(error);
  }
}
