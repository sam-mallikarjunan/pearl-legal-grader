import { randomUUID } from "node:crypto";
import { AccountAuthError, accountAdminClient } from "./account-auth";

/** Generate an OTP through Supabase, then deliver it through the approved email provider. No SMTP credential sharing. */
export async function sendAccountCode(email: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.GRADER_EMAIL_FROM;
  if (!key || !from)
    throw new AccountAuthError(503, "Email sign-in is being configured.");
  const { data, error } = await accountAdminClient().auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const code = data.properties?.email_otp;
  if (error || !code || !/^\d{6,10}$/.test(code)) {
    console.error("grader_auth_code_generation_failed", {
      status: error?.status ?? 0,
      code: error?.code ?? "unexpected_response",
    });
    throw new AccountAuthError(
      503,
      "A sign-in code could not be created. Please try again later.",
    );
  }
  const appUrl =
    process.env.GRADER_APP_URL || "https://pearl-legal-grader.vercel.app";
  const target = new URL("/account", appUrl);
  if (target.protocol !== "https:")
    throw new AccountAuthError(503, "Email sign-in is being configured.");
  const text = `Your Practice Grader sign-in code is ${code}.\n\nEnter it on ${target.href} to open your private workspace. Use the newest code you requested. Never share this code.\n\nIf you did not request this message, you can ignore it. This message does not subscribe you to marketing.`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your sign-in code</title></head><body style="font-family:Arial,sans-serif;color:#243e34;background:#fafbf7;padding:32px"><main style="max-width:520px;margin:auto"><h1 style="font-size:24px">Your private workspace</h1><p>Enter this one-time code in Practice Grader:</p><p style="font-size:32px;letter-spacing:7px;font-weight:bold">${code}</p><p><a href="${target.href}">Open Practice Grader</a></p><p>Use the newest code you requested. Never share this code.</p><p style="font-size:13px;color:#52695e">If you did not request this message, you can ignore it. This message does not subscribe you to marketing.</p></main></body></html>`;
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `grader-auth-${randomUUID()}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Your Practice Grader sign-in code",
        text,
        html,
      }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    throw new AccountAuthError(
      503,
      "The sign-in message could not be requested. Please try again later.",
    );
  }
  // Provider bodies can contain the recipient or credentials. Keep them out of logs and public errors.
  if (!response.ok) {
    console.error("grader_auth_email_provider_failed", {
      status: response.status,
    });
    throw new AccountAuthError(
      503,
      "The sign-in message could not be requested. Please try again later.",
    );
  }
}
