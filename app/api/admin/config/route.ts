import {
  accountErrorResponse,
  boundedAccountBody,
  guardAccountMutation,
  requireOperator,
} from "../../../../lib/server/account-auth";
import {
  ConfigServiceError,
  configErrorResponse,
  getConfigHistory,
  publishConfig,
} from "../../../../lib/server/config-store";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireOperator(request);
    return Response.json(await getConfigHistory(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return error instanceof ConfigServiceError
      ? configErrorResponse(error)
      : accountErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    const actor = await requireOperator(request);
    const body = await boundedAccountBody(request, 250_000);
    return Response.json(
      await publishConfig({
        release: body.release,
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
