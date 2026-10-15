import { isOperator } from "../../../../../lib/server/scan-security";
import { purgeExpiredScans } from "../../../../../lib/server/scan-store";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!isOperator(request))
    return Response.json({ error: "Not found." }, { status: 404 });
  await purgeExpiredScans();
  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export const GET = POST;
