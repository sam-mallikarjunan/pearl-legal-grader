import { isOperator } from "../../../../../lib/server/scan-security";
import { purgeExpiredScans } from "../../../../../lib/server/scan-store";
import { purgeAuthAttempts } from "../../../../../lib/server/auth-limits";
import { purgeReportEmails } from "../../../../../lib/server/report-email";
import { purgeAIReviewUsage } from "../../../../../lib/server/ai-review";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  if (!isOperator(request))
    return Response.json({ error: "Not found." }, { status: 404, headers });
  try {
    await Promise.all([
      purgeExpiredScans(),
      purgeAuthAttempts(),
      purgeReportEmails(),
      purgeAIReviewUsage(),
    ]);
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
