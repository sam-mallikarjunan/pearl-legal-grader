import {
  accountErrorResponse,
  boundedAccountBody,
  guardAccountMutation,
  requireOperator,
} from "../../../../../lib/server/account-auth";
import {
  ConfigServiceError,
  configErrorResponse,
  rollbackConfig,
} from "../../../../../lib/server/config-store";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    const actor = await requireOperator(request);
    const body = await boundedAccountBody(request, 2000);
    return Response.json(
      await rollbackConfig({
        releaseId: body.releaseId as string,
        expectedActiveId: body.expectedActiveId as string,
        reason: body.reason as string,
        actorId: actor.id,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return error instanceof ConfigServiceError
      ? configErrorResponse(error)
      : accountErrorResponse(error);
  }
}
