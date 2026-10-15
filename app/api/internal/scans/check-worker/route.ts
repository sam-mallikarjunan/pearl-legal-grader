import { isOperator } from "../../../../../lib/server/scan-security";
import { inspectWebsite } from "../../../../../lib/server/website-inspect";
import { runSandboxLighthouse } from "../../../../../lib/server/lighthouse";

export const runtime = "nodejs";
export const maxDuration = 180;

const headers = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

/** Internal readiness check: own homepage only; no submitted target or database writes. */
export async function POST(request: Request) {
  if (!isOperator(request))
    return Response.json({ error: "Not found." }, { status: 404, headers });
  try {
    const homepage = new URL("/", request.url).href;
    const result = await inspectWebsite(homepage, undefined, {
      performanceProvider: runSandboxLighthouse,
      maxPages: 1,
    });
    return Response.json(result, { headers });
  } catch {
    return Response.json(
      {
        error:
          "The website audit worker could not complete its readiness check.",
      },
      { status: 503, headers },
    );
  }
}
