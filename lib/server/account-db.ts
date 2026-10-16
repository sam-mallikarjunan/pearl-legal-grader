export class AccountDatabaseError extends Error {
  constructor(
    public code = "database_unavailable",
    public status = 503,
  ) {
    super(
      "The private workspace is temporarily unavailable. Please try again later.",
    );
    this.name = "AccountDatabaseError";
  }
}

export function accountDatabaseConfigured(): boolean {
  return (
    !!process.env.SUPABASE_URL &&
    !!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

/** Service credentials stay in this adapter; callers must derive ownership from verified identity. */
export async function accountRpc(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  if (!/^grader_[a-z_]+$/.test(name)) throw new AccountDatabaseError();
  const endpoint = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!endpoint || !key) throw new AccountDatabaseError("not_configured");
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".supabase.co") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new AccountDatabaseError();
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  let response: Response;
  try {
    response = await fetch(new URL(`/rest/v1/rpc/${name}`, url), {
      method: "POST",
      headers,
      body: JSON.stringify(args),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AccountDatabaseError();
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > 12_000_000) throw new AccountDatabaseError();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new AccountDatabaseError();
  }
  if (!response.ok) {
    // Only stable machine codes escape. Database messages can contain user data.
    const code =
      typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string" &&
      /^[a-z_]{1,80}$/.test(data.message)
        ? data.message
        : "database_unavailable";
    const conflict =
      /conflict|limit|revision|canonical|unverified|not_found|invalid|expired/.test(
        code,
      );
    throw new AccountDatabaseError(
      code,
      /limit/.test(code)
        ? 429
        : /not_found/.test(code)
          ? 404
          : conflict
            ? 409
            : 503,
    );
  }
  return data;
}
