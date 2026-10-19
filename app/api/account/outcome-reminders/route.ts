import {
  requireAccount,
  guardAccountMutation,
} from "../../../../lib/server/account-auth";
import {
  ACCOUNT_HEADERS,
  accountBody,
  accountRouteError,
} from "../../../../lib/server/account-http";
import {
  readOutcomeReminders,
  setOutcomeReminderConsent,
  ReportingReminderUnavailable,
} from "../../../../lib/server/outcome-reminder-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const failure = (e: unknown) =>
  e instanceof ReportingReminderUnavailable
    ? Response.json(
        { code: e.code, error: e.message },
        { status: e.status, headers: ACCOUNT_HEADERS },
      )
    : accountRouteError(e);
export async function GET(r: Request) {
  try {
    const u = await requireAccount(r);
    return Response.json(await readOutcomeReminders(u.id), {
      headers: ACCOUNT_HEADERS,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(r: Request) {
  try {
    guardAccountMutation(r);
    const u = await requireAccount(r);
    return Response.json(
      await setOutcomeReminderConsent(u.id, await accountBody(r, 1000)),
      { headers: ACCOUNT_HEADERS },
    );
  } catch (e) {
    return failure(e);
  }
}
