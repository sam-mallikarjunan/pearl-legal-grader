import { randomUUID } from "node:crypto";
import { AccountAuthError, accountAdminClient } from "./account-auth";

const PROVIDER_ERROR_CODES = new Set([
  "validation_error",
  "missing_required_field",
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "invalid_access",
  "invalid_from_address",
  "invalid_to_address",
  "invalid_region",
  "rate_limit_exceeded",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  "idempotency_key_in_use",
  "invalid_idempotent_request",
  "invalid_idempotency_key",
  "application_error",
  "internal_server_error",
  "not_found",
]);
type FailureCategory =
  | "credentials"
  | "sender"
  | "idempotency"
  | "recipient"
  | "payload"
  | "allowance"
  | "other";
/** A provider may echo credentials, recipients or message contents. Emit only fixed categories and known machine codes. */
export async function authEmailFailureDiagnostic(response: Response): Promise<{
  status: number;
  category: FailureCategory;
  providerName?: string;
  providerCode?: string;
}> {
  const diagnostic: {
    status: number;
    category: FailureCategory;
    providerName?: string;
    providerCode?: string;
  } = { status: response.status, category: "other" };
  const reader = response.body?.getReader();
  if (!reader) return diagnostic;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16_384) return diagnostic;
      chunks.push(part.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return diagnostic;
    const fields = value as Record<string, unknown>;
    if (
      typeof fields.name === "string" &&
      PROVIDER_ERROR_CODES.has(fields.name)
    )
      diagnostic.providerName = fields.name;
    if (
      typeof fields.code === "string" &&
      PROVIDER_ERROR_CODES.has(fields.code)
    )
      diagnostic.providerCode = fields.code;
    const reason = [
      diagnostic.providerName,
      diagnostic.providerCode,
      typeof fields.message === "string" ? fields.message : "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    diagnostic.category =
      /sender|from[ _-]?address|sending[ _-]?domain|domain.{0,60}verif/.test(
        reason,
      )
        ? "sender"
        : /api[ _-]?key|credential|unauthori[sz]ed|restricted_api_key|invalid_access/.test(
              reason,
            )
          ? "credentials"
          : /idempoten/.test(reason)
            ? "idempotency"
            : /recipient|to[ _-]?address/.test(reason)
              ? "recipient"
              : /quota|allowance|rate[ _-]?limit|daily[ _-]?limit|monthly[ _-]?limit/.test(
                    reason,
                  )
                ? "allowance"
                : /validat|payload|missing|required|invalid[ _-]?field|malformed/.test(
                      reason,
                    )
                  ? "payload"
                  : "other";
    return diagnostic;
  } catch {
    return diagnostic;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Generate an OTP through Supabase, then deliver it through the approved email provider. No SMTP credential sharing. */
export async function sendAccountCode(email: string) {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.GRADER_EMAIL_FROM?.trim();
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
    console.error(
      "grader_auth_email_provider_failed",
      await authEmailFailureDiagnostic(response),
    );
    throw new AccountAuthError(
      503,
      "The sign-in message could not be requested. Please try again later.",
    );
  }
}
