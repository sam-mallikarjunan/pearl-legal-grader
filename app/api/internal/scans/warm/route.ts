import { isOperator } from "../../../../../lib/server/scan-security";
import {
  lighthouseSetupDiagnostic,
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
    const diagnostic = lighthouseSetupDiagnostic(error);
    console.error("lighthouse_warm_failed", diagnostic);
    return Response.json(
      { error: "The audit worker could not be prepared.", ...diagnostic },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
