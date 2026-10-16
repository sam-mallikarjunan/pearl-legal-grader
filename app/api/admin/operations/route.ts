import {
  accountErrorResponse,
  requireOperator,
} from "../../../../lib/server/account-auth";
import { accountRpc } from "../../../../lib/server/account-db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireOperator(request);
    return Response.json(
      {
        health: await accountRpc("grader_operator_health"),
        limits: {
          scans: { day: 30, month: 300 },
          signInCodes: { day: 50, month: 500 },
          reportEmails: { day: 100, month: 1000 },
        },
        note: "Usage counts are operational allowances, not a billing statement. Queued work, provider acceptance and delivery have different meanings.",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return accountErrorResponse(error);
  }
}
