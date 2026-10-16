import {
  guardAccountMutation,
  requireAccount,
} from "../../../../../../lib/server/account-auth";
import {
  accountBody,
  accountRouteError,
  ACCOUNT_HEADERS,
} from "../../../../../../lib/server/account-http";
import {
  AIReviewError,
  createWebsiteAIReview,
  readWebsiteAIReview,
} from "../../../../../../lib/server/ai-review";
import { parseAIReviewConsent } from "../../../../../../lib/ai-review";

export const runtime = "nodejs";
export const maxDuration = 90;
type Context = { params: Promise<{ id: string }> };
function errorResponse(error: unknown) {
  return error instanceof AIReviewError
    ? Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: ACCOUNT_HEADERS },
      )
    : accountRouteError(error);
}
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireAccount(request);
    return Response.json(
      await readWebsiteAIReview(user.id, (await context.params).id),
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    if (!parseAIReviewConsent(await accountBody(request, 1000)))
      return Response.json(
        {
          error:
            "Explicitly choose to send only the saved public website excerpts for this explanation.",
          code: "ai_consent_required",
        },
        { status: 400, headers: ACCOUNT_HEADERS },
      );
    const result = await createWebsiteAIReview(
      user.id,
      (await context.params).id,
    );
    return Response.json(result, {
      status: result.state === "pending" ? 202 : 200,
      headers: ACCOUNT_HEADERS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
