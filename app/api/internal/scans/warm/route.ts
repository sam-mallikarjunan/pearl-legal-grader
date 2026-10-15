import { isOperator } from "../../../../../lib/server/scan-security";
import {
  LighthouseSetupError,
  prepareLighthouseSandboxSnapshot,
} from "../../../../../lib/server/lighthouse";

export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(request: Request) {
  if (!isOperator(request))
    return Response.json(
      { error: "Not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  try {
    return Response.json(await prepareLighthouseSandboxSnapshot(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const stage =
      error instanceof LighthouseSetupError ? error.stage : "create";
    console.error("lighthouse_warm_failed", { stage });
    return Response.json(
      { error: "The audit worker could not be prepared.", stage },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
