import { AccountDataError } from "../account/validation";
import { ACCOUNT_REPORT_BYTES } from "../account/types";
import { accountErrorResponse } from "./account-auth";
import { AccountStorageError } from "./account-store";

export const ACCOUNT_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};
export async function accountBody(
  request: Request,
  limit = ACCOUNT_REPORT_BYTES,
): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new AccountDataError("invalid_body", "Send a small JSON request.");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new AccountDataError(
      "request_too_large",
      "This request is too large.",
      413,
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new AccountDataError("invalid_body", "This request is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit)
        throw new AccountDataError(
          "request_too_large",
          "This request is too large.",
          413,
        );
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new AccountDataError(
        "invalid_body",
        "This JSON request could not be read.",
      );
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export function accountRouteError(error: unknown): Response {
  if (error instanceof AccountDataError || error instanceof AccountStorageError)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: ACCOUNT_HEADERS },
    );
  return accountErrorResponse(error);
}
