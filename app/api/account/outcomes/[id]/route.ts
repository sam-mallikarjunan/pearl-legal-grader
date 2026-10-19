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
  deleteOwnOutcome,
  OutcomeStorageError,
  updateOwnOutcome,
} from "../../../../../lib/server/outcome-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  return error instanceof OutcomeInputError ||
    error instanceof OutcomeStorageError
    ? Response.json(
        { code: error.code, error: error.message },
        { status: error.status, headers: ACCOUNT_HEADERS },
      )
    : accountRouteError(error);
}
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    return Response.json(
      {
        period: await updateOwnOutcome(
          user.id,
          (await context.params).id,
          await accountBody(request, 6000),
        ),
      },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    await deleteOwnOutcome(
      user.id,
      (await context.params).id,
      await accountBody(request, 1000),
    );
    return Response.json({ deleted: true }, { headers: ACCOUNT_HEADERS });
  } catch (error) {
    return failure(error);
  }
}
