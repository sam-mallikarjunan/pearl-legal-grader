import {
  accountClient,
  accountErrorResponse,
  AccountAuthError,
  boundedAccountBody,
  guardAccountMutation,
  normalizeAccountEmail,
} from "../../../../lib/server/account-auth";
import { reserveAuthAttempt } from "../../../../lib/server/auth-limits";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    const body = await boundedAccountBody(request);
    const email = normalizeAccountEmail(body.email);
    if (
      !email ||
      typeof body.code !== "string" ||
      !/^\d{6,10}$/.test(body.code)
    )
      throw new AccountAuthError(
        400,
        "Enter your email address and one-time code.",
      );
    await reserveAuthAttempt(request, email, "verify");
    const client = await accountClient();
    const { data, error } = await client.auth.verifyOtp({
      email,
      token: body.code,
      type: "email",
    });
    if (error || !data.user?.email_confirmed_at || !data.session)
      throw new AccountAuthError(
        400,
        "That code is invalid or expired. Request a new code and try again.",
      );
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  } catch (error) {
    return accountErrorResponse(error);
  }
}
