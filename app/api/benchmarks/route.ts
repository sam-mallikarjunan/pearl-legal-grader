import { benchmarkAvailability } from "../../../lib/peer";

/** This endpoint deliberately exposes no unreviewed counts or live filters. */
export async function GET() {
  return Response.json(benchmarkAvailability(), {
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
