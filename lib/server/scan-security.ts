import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function newScanToken(): string {
  return randomBytes(32).toString("base64url");
}
export function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function scanClientHash(request: Request): string {
  const secret = process.env.SCAN_HASH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Scan service is not configured.");
  // Vercel overwrites this header at its proxy. Never accept a client-supplied ID for quotas.
  const address = process.env.VERCEL
    ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown"
    : "local-development";
  return createHmac("sha256", secret).update(address).digest("hex");
}

export function readScanToken(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
    request.headers.get("authorization") || "",
  );
  return match?.[1] || null;
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function isOperator(request: Request): boolean {
  const expected = process.env.SCAN_OPERATOR_SECRET;
  const provided = request.headers
    .get("authorization")
    ?.replace(/^Bearer /, "");
  if (!expected || expected.length < 32 || !provided) return false;
  const a = tokenDigest(provided);
  const b = tokenDigest(expected);
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
