import { createHash, timingSafeEqual } from "node:crypto";
import { dispatchDueNurture } from "../../../../lib/server/nurture-dispatch";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET,
    supplied = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (
    !secret ||
    secret.length < 32 ||
    !supplied ||
    !timingSafeEqual(
      createHash("sha256").update(secret).digest(),
      createHash("sha256").update(supplied).digest(),
    )
  )
    return Response.json({ error: "Not found." }, { status: 404, headers });
  try {
    return Response.json(await dispatchDueNurture(), { headers });
  } catch {
    return Response.json(
      { error: "The educational email queue is temporarily unavailable." },
      { status: 503, headers },
    );
  }
}
