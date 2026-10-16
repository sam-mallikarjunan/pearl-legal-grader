import {
  boundedWebhookBody,
  ingestResendWebhook,
  InvalidResendWebhook,
  verifyResendWebhook,
} from "../../../../lib/server/resend-webhook";
export const runtime = "nodejs";
export const maxDuration = 15;
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET,
    hashSecret = process.env.SCAN_HASH_SECRET;
  if (!secret || !hashSecret)
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  try {
    const payload = verifyResendWebhook(
      await boundedWebhookBody(request),
      request.headers,
      secret,
    );
    await ingestResendWebhook(
      payload,
      request.headers.get("svix-id")!,
      hashSecret,
    );
    return Response.json(
      { received: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof InvalidResendWebhook
            ? "Invalid webhook."
            : "Webhook temporarily unavailable.",
      },
      {
        status: error instanceof InvalidResendWebhook ? 400 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
