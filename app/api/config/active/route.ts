import {
  configErrorResponse,
  getActiveConfig,
} from "../../../../lib/server/config-store";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(await getActiveConfig(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return configErrorResponse(error);
  }
}
