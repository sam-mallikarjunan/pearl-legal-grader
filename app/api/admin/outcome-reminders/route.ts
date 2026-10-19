import {
  requireOperator,
  guardAccountMutation,
} from "../../../../lib/server/account-auth";
import {
  ACCOUNT_HEADERS,
  accountBody,
  accountRouteError,
} from "../../../../lib/server/account-http";
import {
  outcomeReminderOperations,
  pauseOutcomeReminders,
} from "../../../../lib/server/outcome-reminder-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  try {
    await requireOperator(r);
    return Response.json(await outcomeReminderOperations(), {
      headers: ACCOUNT_HEADERS,
    });
  } catch (e) {
    return accountRouteError(e);
  }
}
export async function PATCH(r: Request) {
  try {
    guardAccountMutation(r);
    await requireOperator(r);
    return Response.json(
      await pauseOutcomeReminders(await accountBody(r, 1000)),
      { headers: ACCOUNT_HEADERS },
    );
  } catch (e) {
    return accountRouteError(e);
  }
}
