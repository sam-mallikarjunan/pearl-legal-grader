import {
  accountErrorResponse,
  AccountAuthError,
  boundedAccountBody,
  guardAccountMutation,
  normalizeAccountEmail,
} from "../../../../lib/server/account-auth";
import { reserveAuthAttempt } from "../../../../lib/server/auth-limits";
import { sendAccountCode } from "../../../../lib/server/auth-email";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    if (process.env.AUTH_EMAIL_ENABLED !== "true")
      throw new AccountAuthError(
        503,
        "Email sign-in is not available yet. Your assessment and device history are still available.",
      );
    const body = await boundedAccountBody(request);
    const email = normalizeAccountEmail(body.email);
    if (!email) throw new AccountAuthError(400, "Enter a valid email address.");
    await reserveAuthAttempt(request, email, "request");
    await sendAccountCode(email);
    return Response.json(
      {
        accepted: true,
        emailConfigured: true,
        message:
          "If the address can receive account email, a one-time sign-in code has been requested.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return accountErrorResponse(error);
  }
}
