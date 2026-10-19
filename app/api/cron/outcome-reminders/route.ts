import { createHash, timingSafeEqual } from "node:crypto";
import { dispatchOutcomeReminders } from "../../../../lib/server/outcome-reminder-dispatch";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(r: Request) {
  const expected = process.env.CRON_SECRET,
    supplied = r.headers.get("authorization")?.replace(/^Bearer /, "");
  const headers = { "Cache-Control": "no-store" };
  if (
    !expected ||
    expected.length < 32 ||
    !supplied ||
    !timingSafeEqual(
      createHash("sha256").update(expected).digest(),
      createHash("sha256").update(supplied).digest(),
    )
  )
    return Response.json({ error: "Not found." }, { status: 404, headers });
  try {
    return Response.json(await dispatchOutcomeReminders(), { headers });
  } catch {
    return Response.json(
      { error: "Reporting reminders are temporarily unavailable." },
      { status: 503, headers },
    );
  }
}
