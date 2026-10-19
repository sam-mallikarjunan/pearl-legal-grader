import {
  guardAccountMutation,
  requireAccount,
} from "../../../../lib/server/account-auth";
import {
  ACCOUNT_HEADERS,
  accountBody,
  accountRouteError,
} from "../../../../lib/server/account-http";
import {
  enrollNurture,
  readNurtureEnrollment,
  withdrawNurture,
  NurtureUnavailable,
} from "../../../../lib/server/nurture-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  return error instanceof NurtureUnavailable
    ? Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: ACCOUNT_HEADERS },
      )
    : accountRouteError(error);
}
export async function GET(request: Request) {
  try {
    const user = await requireAccount(request);
    return Response.json(await readNurtureEnrollment(user.id), {
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
      await enrollNurture(user, await accountBody(request, 2000)),
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    return Response.json(await withdrawNurture(user.id), {
      headers: ACCOUNT_HEADERS,
    });
  } catch (error) {
    return failure(error);
  }
}
