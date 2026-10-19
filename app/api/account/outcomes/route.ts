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
  createOwnOutcome,
  OutcomeStorageError,
  readOwnOutcomes,
  setOwnOutcomeResearchConsent,
} from "../../../../lib/server/outcome-store";
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
export async function GET(request: Request) {
  try {
    const user = await requireAccount(request);
    return Response.json(await readOwnOutcomes(user.id), {
      headers: ACCOUNT_HEADERS,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    return Response.json(
      {
        period: await createOwnOutcome(
          user.id,
          await accountBody(request, 5000),
        ),
      },
      { status: 201, headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(request: Request) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    return Response.json(
      {
        consent: await setOwnOutcomeResearchConsent(
          user.id,
          await accountBody(request, 1000),
        ),
      },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return failure(error);
  }
}
