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
  ActionObservationStorageError,
  readOwnActionObservations,
  registerOwnActionObservation,
} from "../../../../lib/server/action-observation-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(e: unknown) {
  return e instanceof OutcomeInputError ||
    e instanceof ActionObservationStorageError
    ? Response.json(
        { code: e.code, error: e.message },
        { status: e.status, headers: ACCOUNT_HEADERS },
      )
    : accountRouteError(e);
}
export async function GET(request: Request) {
  try {
    const user = await requireAccount(request);
    return Response.json(await readOwnActionObservations(user.id), {
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
        observation: await registerOwnActionObservation(
          user.id,
          await accountBody(request, 4000),
        ),
      },
      { status: 201, headers: ACCOUNT_HEADERS },
    );
  } catch (e) {
    return failure(e);
  }
}
