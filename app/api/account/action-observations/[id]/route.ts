import {
  guardAccountMutation,
  requireAccount,
} from "../../../../../lib/server/account-auth";
import {
  ACCOUNT_HEADERS,
  accountBody,
  accountRouteError,
} from "../../../../../lib/server/account-http";
import { OutcomeInputError } from "../../../../../lib/outcomes";
import {
  ActionObservationStorageError,
  checkInOwnActionObservation,
  withdrawOwnActionObservation,
} from "../../../../../lib/server/action-observation-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function failure(e: unknown) {
  return e instanceof OutcomeInputError ||
    e instanceof ActionObservationStorageError
    ? Response.json(
        { code: e.code, error: e.message },
        { status: e.status, headers: ACCOUNT_HEADERS },
      )
    : accountRouteError(e);
}
export async function PATCH(request: Request, context: Context) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    return Response.json(
      {
        observation: await checkInOwnActionObservation(
          user.id,
          (await context.params).id,
          await accountBody(request, 2000),
        ),
      },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    return Response.json(
      {
        observation: await withdrawOwnActionObservation(
          user.id,
          (await context.params).id,
          await accountBody(request, 1000),
        ),
      },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (e) {
    return failure(e);
  }
}
