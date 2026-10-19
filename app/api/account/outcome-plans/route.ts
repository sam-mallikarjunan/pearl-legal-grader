import {
  guardAccountMutation,
  requireAccount,
} from "../../../../lib/server/account-auth";
import {
  ACCOUNT_HEADERS,
  accountBody,
  accountRouteError,
} from "../../../../lib/server/account-http";
import { OutcomeInputError } from "../../../../lib/outcomes";
import {
  OutcomePlanStorageError,
  readOwnOutcomePlans,
  createOwnOutcomePlan,
} from "../../../../lib/server/outcome-plan-store";
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
export async function GET(request: Request) {
  try {
    const user = await requireAccount(request);
    return Response.json(await readOwnOutcomePlans(user.id), {
      headers: ACCOUNT_HEADERS,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    return Response.json(
      {
        plan: await createOwnOutcomePlan(
          user.id,
          await accountBody(request, 2000),
        ),
      },
      { status: 201, headers: ACCOUNT_HEADERS },
    );
  } catch (e) {
    return failure(e);
  }
}
