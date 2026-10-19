import {
  guardAccountMutation,
  requireOperator,
} from "../../../../../lib/server/account-auth";
import {
  ACCOUNT_HEADERS,
  accountBody,
  accountRouteError,
} from "../../../../../lib/server/account-http";
import {
  AccountDataError,
  accountRecord,
} from "../../../../../lib/account/validation";
import { dispatchDueNurture } from "../../../../../lib/server/nurture-dispatch";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    await requireOperator(request);
    const body = await accountBody(request, 1000);
    if (
      !accountRecord(body) ||
      Object.keys(body).length !== 1 ||
      body.confirm !== "DISPATCH DUE LESSONS"
    )
      throw new AccountDataError(
        "invalid_nurture_dispatch",
        "Confirm sending the next due lesson to currently enrolled accounts.",
      );
    return Response.json(await dispatchDueNurture(), {
      headers: ACCOUNT_HEADERS,
    });
  } catch (error) {
    return accountRouteError(error);
  }
}
