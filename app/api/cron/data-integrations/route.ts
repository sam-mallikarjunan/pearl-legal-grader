import { createHash, timingSafeEqual } from "node:crypto";
import { dataIntegrationStore } from "../../../../lib/server/data-integration-store";
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
    let expired = 0;
    for (let i = 0; i < 4; i++) {
      const result = await dataIntegrationStore().cleanup();
      expired += result.expired;
      if (result.expired < 500) break;
    }
    return Response.json({ expired }, { headers });
  } catch {
    return Response.json(
      { error: "Data delivery maintenance is temporarily unavailable." },
      { status: 503, headers },
    );
  }
}
