import {
  accountAuthConfigured,
  accountErrorResponse,
  isAdminEmail,
  readAccount,
} from "../../../../lib/server/account-auth";
import { reportEmailEnabled } from "../../../../lib/server/report-email";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await readAccount(request);
    return Response.json(
      {
        configured: accountAuthConfigured(),
        emailConfigured: process.env.AUTH_EMAIL_ENABLED === "true",
        reportEmailConfigured: reportEmailEnabled(),
        user: user
          ? { id: user.id, email: user.email, admin: isAdminEmail(user.email) }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return accountErrorResponse(error);
  }
}
