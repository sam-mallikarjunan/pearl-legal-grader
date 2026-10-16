import { start } from "workflow/api";
import {
  requireAccount,
  guardAccountMutation,
} from "../../../../../../lib/server/account-auth";
import {
  accountBody,
  accountRouteError,
  ACCOUNT_HEADERS,
} from "../../../../../../lib/server/account-http";
import {
  failReportEmailQueue,
  listReportEmails,
  recordReportEmailWorkflow,
  reserveReportEmail,
  ReportEmailUnavailable,
} from "../../../../../../lib/server/report-email";
import { reportEmailWorkflow } from "../../../../../../workflows/report-email";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAccount(request);
    const emails = await listReportEmails(user.id, (await context.params).id);
    return Response.json({ emails }, { headers: ACCOUNT_HEADERS });
  } catch (error) {
    return accountRouteError(error);
  }
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    const result = await reserveReportEmail(
      user,
      (await context.params).id,
      await accountBody(request, 2000),
    );
    if (result.start) {
      try {
        const run = await start(reportEmailWorkflow, [result.email.id]);
        await recordReportEmailWorkflow(result.email.id, run.runId).catch(
          () => {},
        );
      } catch {
        await failReportEmailQueue(result.email.id).catch(() => {});
        throw new ReportEmailUnavailable();
      }
    }
    return Response.json(
      { email: result.email, queued: result.start },
      { status: result.created ? 202 : 200, headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    if (error instanceof ReportEmailUnavailable)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: ACCOUNT_HEADERS },
      );
    return accountRouteError(error);
  }
}
