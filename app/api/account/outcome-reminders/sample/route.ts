import {
  requireAccount,
  guardAccountMutation,
} from "../../../../../lib/server/account-auth";
import {
  ACCOUNT_HEADERS,
  accountBody,
  accountRouteError,
} from "../../../../../lib/server/account-http";
import {
  reserveOutcomeReminderSample,
  ReportingReminderUnavailable,
} from "../../../../../lib/server/outcome-reminder-store";
import { startOutcomeReminder } from "../../../../../lib/server/outcome-reminder-dispatch";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(r: Request) {
  try {
    guardAccountMutation(r);
    const u = await requireAccount(r);
    const result = await reserveOutcomeReminderSample(
      u.id,
      await accountBody(r, 1000),
    );
    const queued = result.dispatch
      ? await startOutcomeReminder(result.messageId)
      : false;
    return Response.json(
      {
        messageId: result.messageId,
        queued,
        alreadyRequested: !result.dispatch,
      },
      { status: 202, headers: ACCOUNT_HEADERS },
    );
  } catch (e) {
    return e instanceof ReportingReminderUnavailable
      ? Response.json(
          { code: e.code, error: e.message },
          { status: e.status, headers: ACCOUNT_HEADERS },
        )
      : accountRouteError(e);
  }
}
