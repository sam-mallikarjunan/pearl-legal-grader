import { createHmac } from "node:crypto";
import { accountRpc } from "./account-db";
import { AccountAuthError } from "./account-auth";
import { scanClientHash } from "./scan-security";
export async function reserveAuthAttempt(
  request: Request,
  email: string,
  kind: "request" | "verify",
) {
  const secret = process.env.SCAN_HASH_SECRET;
  if (!secret || secret.length < 32)
    throw new AccountAuthError(503, "Account access is being configured.");
  const emailHash = createHmac("sha256", secret)
    .update("account-email:" + email)
    .digest("hex");
  await accountRpc("grader_auth_reserve", {
    p_kind: kind,
    p_email_hash: emailHash,
    p_client_hash: scanClientHash(request),
  });
}
export async function purgeAuthAttempts() {
  await accountRpc("grader_auth_purge");
}
