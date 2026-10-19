import {
  guardAccountMutation,
  requireAccount,
} from "../../../../../../lib/server/account-auth";
import {
  ACCOUNT_HEADERS,
  accountBody,
  accountRouteError,
} from "../../../../../../lib/server/account-http";
import { OutcomeInputError } from "../../../../../../lib/outcomes";
import {
  OutcomePlanStorageError,
  reportOwnOutcomePlan,
} from "../../../../../../lib/server/outcome-plan-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  return error instanceof OutcomeInputError ||
    error instanceof OutcomePlanStorageError
    ? Response.json(
        { code: error.code, error: error.message },
        { status: error.status, headers: ACCOUNT_HEADERS },
      )
    : accountRouteError(error);
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    return Response.json(
      await reportOwnOutcomePlan(
        user.id,
        (await context.params).id,
        await accountBody(request, 2500),
      ),
      { headers: ACCOUNT_HEADERS },
    );
  } catch (e) {
    return failure(e);
  }
}
