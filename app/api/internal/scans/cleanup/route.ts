import { isOperator } from "../../../../../lib/server/scan-security";
import { purgeExpiredScans } from "../../../../../lib/server/scan-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  if (!isOperator(request))
    return Response.json({ error: "Not found." }, { status: 404, headers });
  try {
    await purgeExpiredScans();
    return Response.json({ ok: true }, { headers });
  } catch {
    console.error("website_scan_cleanup_unavailable");
    return Response.json(
      { error: "Scan cleanup is temporarily unavailable." },
      { status: 503, headers },
    );
  }
}
export const GET = POST;
