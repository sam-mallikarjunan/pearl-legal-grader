import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AccountDatabaseError } from "./account-db";

export interface AccountIdentity {
  id: string;
  email: string;
}
export class AccountAuthError extends Error {
  constructor(
    public status = 401,
    message = "Sign in to your private workspace.",
  ) {
    super(message);
    this.name = "AccountAuthError";
  }
}
export function accountAuthConfigured(): boolean {
  return (
    process.env.ACCOUNTS_ENABLED === "true" &&
    !!process.env.SUPABASE_URL &&
    !!process.env.SUPABASE_PUBLISHABLE_KEY
  );
}
export function guardAccountMutation(request: Request): void {
  const origin = request.headers.get("origin");
  if (
    !origin ||
    origin !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AccountAuthError(403, "Open this request from the grader.");
}
export function normalizeAccountEmail(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 254) return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}
export function isAdminEmail(email: string): boolean {
  const list = (process.env.GRADER_ADMIN_EMAILS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
export async function accountClient() {
  if (!accountAuthConfigured())
    throw new AccountAuthError(
      503,
      "Private account access is being configured. Your local reports remain available.",
    );
  const jar = await cookies();
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      },
      cookies: {
        getAll() {
          return jar.getAll();
        },
        setAll(items) {
          for (const item of items)
            jar.set(item.name, item.value, item.options);
        },
      },
    },
  );
}
export function accountAdminClient() {
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.SUPABASE_URL || !key)
    throw new AccountAuthError(503, "Account access is being configured.");
  return createClient(process.env.SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
export async function readAccount(
  _request?: Request,
): Promise<AccountIdentity | null> {
  if (!accountAuthConfigured()) return null;
  const client = await accountClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || !data.user.email || !data.user.email_confirmed_at)
    return null;
  return { id: data.user.id, email: data.user.email };
}
export async function requireAccount(
  request: Request,
): Promise<AccountIdentity> {
  const user = await readAccount(request);
  if (!user) throw new AccountAuthError();
  return user;
}
interface RecentSessionVerifier {
  getUser(): Promise<{
    data: { user: { id: string; email_confirmed_at?: string } | null };
    error: unknown;
  }>;
  getClaims(): Promise<{
    data: { claims: unknown } | null;
    error: unknown;
  }>;
}
/** Use only SDK-verified current-session AMR, never decoded cookies, token issue time or user metadata. */
export async function requireRecentAccountAuthentication(
  auth: RecentSessionVerifier,
  userId: string,
  now = Date.now(),
): Promise<void> {
  const stale = () =>
    new AccountAuthError(
      403,
      "Sign in again with a new code before deleting your private workspace.",
    );
  let fresh, verified;
  try {
    // Keep the live user check: signature validity alone does not establish that an account still exists.
    [fresh, verified] = await Promise.all([auth.getUser(), auth.getClaims()]);
  } catch {
    throw stale();
  }
  if (
    fresh.error ||
    fresh.data.user?.id !== userId ||
    !fresh.data.user.email_confirmed_at
  )
    throw new AccountAuthError();
  const claims = verified.data?.claims;
  if (
    verified.error ||
    !claims ||
    typeof claims !== "object" ||
    Array.isArray(claims)
  )
    throw stale();
  const fields = claims as Record<string, unknown>;
  if (
    fields.sub !== userId ||
    fields.role !== "authenticated" ||
    typeof fields.session_id !== "string" ||
    !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(
      fields.session_id,
    ) ||
    !Array.isArray(fields.amr) ||
    fields.amr.length > 32 ||
    !Number.isFinite(now)
  )
    throw stale();
  const seconds = Math.floor(now / 1000);
  const recent = fields.amr.some((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return false;
    const item = entry as Record<string, unknown>;
    // These are the interactive email-code methods supported by this app. Refresh is not reauthentication.
    return (
      (item.method === "otp" || item.method === "magiclink") &&
      typeof item.timestamp === "number" &&
      Number.isSafeInteger(item.timestamp) &&
      item.timestamp > 0 &&
      item.timestamp >= seconds - 15 * 60 &&
      item.timestamp <= seconds + 30
    );
  });
  if (!recent) throw stale();
}
export async function requireOperator(
  request: Request,
): Promise<AccountIdentity> {
  const user = await requireAccount(request);
  if (!isAdminEmail(user.email))
    throw new AccountAuthError(
      403,
      "This account does not have administrator access.",
    );
  return user;
}
export function accountErrorResponse(error: unknown): Response {
  if (error instanceof AccountAuthError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  if (error instanceof AccountDatabaseError)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  return Response.json(
    { error: "The request could not finish. Please try again." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
export async function boundedAccountBody(
  request: Request,
  maxBytes = 16_384,
): Promise<Record<string, unknown>> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new AccountAuthError(400, "Send a JSON request.");
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new AccountAuthError(413, "This request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new AccountAuthError(400, "A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes)
        throw new AccountAuthError(413, "This request is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AccountAuthError(400, "Check the request and try again.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AccountAuthError(400, "Check the request and try again.");
  return value as Record<string, unknown>;
}
