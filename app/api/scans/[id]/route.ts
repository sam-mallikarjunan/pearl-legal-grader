import { scanConfiguration } from "../../../../lib/server/scan-config";
import {
  readScanToken,
  tokenDigest,
} from "../../../../lib/server/scan-security";
import { readScan } from "../../../../lib/server/scan-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!scanConfiguration().enabled)
    return Response.json(
      { error: "Website checks are temporarily unavailable." },
      { status: 503, headers },
    );
  const { id } = await context.params;
  const token = readScanToken(request);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    ) ||
    !token
  )
    return Response.json(
      {
        error:
          "This scan needs its private access key from the device that started it.",
      },
      { status: 401, headers },
    );
  try {
    const scan = await readScan(id, tokenDigest(token));
    if (!scan)
      return Response.json(
        {
          error:
            "This scan is unavailable or its 30-day retention period has ended. Start a new website check.",
        },
        { status: 404, headers },
      );
    return Response.json(scan, { headers });
  } catch {
    return Response.json(
      { error: "The scan status is temporarily unavailable." },
      { status: 503, headers },
    );
  }
}
