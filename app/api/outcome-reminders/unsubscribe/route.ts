import { unsubscribeOutcomeReminders } from "../../../../lib/server/outcome-reminder-store";
import {
  ACCOUNT_HEADERS,
  accountRouteError,
} from "../../../../lib/server/account-http";
import { AccountDataError } from "../../../../lib/account/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const source = new URL(request.url),
    target = new URL("/outcome-reminders/unsubscribe", source.origin);
  target.searchParams.set(
    "token",
    source.searchParams.get("token")?.slice(0, 250) || "",
  );
  return new Response(null, {
    status: 303,
    headers: { ...ACCOUNT_HEADERS, Location: target.toString() },
  });
}
/** RFC 8058 accepts a signed capability without cookies or login; GET never withdraws consent. */
export async function POST(request: Request) {
  try {
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/x-www-form-urlencoded")
    )
      throw new AccountDataError(
        "invalid_unsubscribe",
        "Send the unsubscribe confirmation.",
      );
    const declared = request.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > 512))
      throw new AccountDataError(
        "invalid_unsubscribe",
        "This request is too large.",
        413,
      );
    const reader = request.body?.getReader();
    if (!reader)
      throw new AccountDataError(
        "invalid_unsubscribe",
        "Send the unsubscribe confirmation.",
      );
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 512)
          throw new AccountDataError(
            "invalid_unsubscribe",
            "This request is too large.",
            413,
          );
        parts.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const form = new URLSearchParams(Buffer.concat(parts).toString("utf8"));
    if (
      form.get("List-Unsubscribe") !== "One-Click" ||
      [...form.keys()].some((k) => k !== "List-Unsubscribe") ||
      form.getAll("List-Unsubscribe").length !== 1
    )
      throw new AccountDataError(
        "invalid_unsubscribe",
        "Send the unsubscribe confirmation.",
      );
    const token = new URL(request.url).searchParams.get("token") || "";
    if (token.length > 250)
      throw new AccountDataError(
        "invalid_unsubscribe",
        "This unsubscribe link is invalid or expired.",
      );
    await unsubscribeOutcomeReminders(token);
    if (request.headers.get("accept")?.includes("text/html"))
      return new Response(null, {
        status: 303,
        headers: {
          ...ACCOUNT_HEADERS,
          Location: new URL(
            "/outcome-reminders/unsubscribed",
            request.url,
          ).toString(),
        },
      });
    return new Response(null, { status: 200, headers: ACCOUNT_HEADERS });
  } catch (error) {
    return accountRouteError(error);
  }
}
