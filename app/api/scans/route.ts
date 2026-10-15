import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { websiteScanWorkflow } from "../../../workflows/website-scan";
import { scanConfiguration } from "../../../lib/server/scan-config";
import {
  isSameOriginRequest,
  newScanToken,
  scanClientHash,
  tokenDigest,
} from "../../../lib/server/scan-security";
import {
  reserveScan,
  recordWorkflowRun,
  failScan,
  ScanLimitError,
} from "../../../lib/server/scan-store";
import {
  normalizeWebsiteUrl,
  resolvePublicAddressWithin,
  WebsiteFetchError,
} from "../../../lib/server/website-fetch";
import {
  WEBSITE_RUBRIC_VERSION,
  WEBSITE_SCANNER_VERSION,
} from "../../../lib/website/types";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

async function boundedBody(request: Request): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new Error("invalid_body");
  if (Number(request.headers.get("content-length")) > 4096)
    throw new Error("invalid_body");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new Error("invalid_body");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function POST(request: Request) {
  if (!scanConfiguration().enabled)
    return Response.json(
      {
        error:
          "Live website checks are not configured yet. Your questionnaire remains available.",
      },
      { status: 503, headers },
    );
  if (!isSameOriginRequest(request))
    return Response.json(
      { error: "Start website checks from the grader." },
      { status: 403, headers },
    );
  let body: unknown;
  try {
    body = await boundedBody(request);
  } catch {
    return Response.json(
      { error: "Send one public website URL in a small JSON request." },
      { status: 400, headers },
    );
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof (body as { url?: unknown }).url !== "string" ||
    ((body as { force?: unknown }).force !== undefined &&
      typeof (body as { force?: unknown }).force !== "boolean")
  )
    return Response.json(
      { error: "Enter a public website URL." },
      { status: 400, headers },
    );
  try {
    const input = body as { url: string; force?: boolean };
    const submitted = normalizeWebsiteUrl(input.url);
    // A practice audit always begins at its public home page, without tracking or sign-in URLs.
    const canonical = new URL("/", submitted);
    await resolvePublicAddressWithin(canonical);
    const accessToken = newScanToken();
    const reserved = await reserveScan({
      id: randomUUID(),
      url: canonical.href,
      urlHash: tokenDigest(canonical.href),
      tokenHash: tokenDigest(accessToken),
      clientHash: scanClientHash(request),
      scannerVersion: WEBSITE_SCANNER_VERSION,
      rubricVersion: WEBSITE_RUBRIC_VERSION,
      force: input.force === true,
    });
    if (reserved.start) {
      try {
        const run = await start(websiteScanWorkflow, [reserved.scanId]);
        // Do not enqueue a second run if saving its identifier temporarily fails.
        await recordWorkflowRun(reserved.scanId, run.runId).catch(() => {});
      } catch {
        await failScan(
          reserved.scanId,
          "queue-start",
          "The website check could not be queued. Please try again later.",
        ).catch(() => {});
        return Response.json(
          {
            error:
              "The website check could not be queued. Please try again later.",
          },
          { status: 503, headers },
        );
      }
    }
    return Response.json(
      {
        scanId: reserved.scanId,
        accessToken,
        status: reserved.status,
        stage: reserved.stage,
        cached: reserved.cached,
        ...(reserved.result ? { result: reserved.result } : {}),
      },
      { status: reserved.start ? 202 : 200, headers },
    );
  } catch (error) {
    if (error instanceof WebsiteFetchError)
      return Response.json({ error: error.message }, { status: 400, headers });
    if (error instanceof ScanLimitError)
      return Response.json(
        { error: error.message },
        {
          status: 429,
          headers: {
            ...headers,
            "Retry-After": String(error.retryAfterSeconds),
          },
        },
      );
    console.error("website_scan_submission_failed", {
      type: error instanceof Error ? error.name : "unknown",
    });
    return Response.json(
      {
        error:
          "The scan service is temporarily unavailable. Your questionnaire is still available.",
      },
      { status: 503, headers },
    );
  }
}
