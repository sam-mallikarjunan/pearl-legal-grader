import {
  accountErrorResponse,
  boundedAccountBody,
  guardAccountMutation,
  requireAccount,
} from "../../../../lib/server/account-auth";
import { ACCOUNT_HEADERS } from "../../../../lib/server/account-http";
import {
  leaderboardStore,
  LeaderboardServiceError,
  leaderboardErrorResponse,
} from "../../../../lib/server/leaderboard-store";
export const dynamic = "force-dynamic";
const fail = (error: unknown) =>
  error instanceof LeaderboardServiceError
    ? leaderboardErrorResponse(error)
    : accountErrorResponse(error);
export async function GET(request: Request) {
  try {
    const user = await requireAccount(request);
    return Response.json(await leaderboardStore().own(user.id), {
      headers: ACCOUNT_HEADERS,
    });
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    return Response.json(
      {
        enrollment: await leaderboardStore().publish(
          user.id,
          await boundedAccountBody(request, 2000),
        ),
      },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return fail(error);
  }
}
export async function DELETE(request: Request) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    return Response.json(
      {
        enrollment: await leaderboardStore().withdraw(
          user.id,
          await boundedAccountBody(request, 1000),
        ),
      },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return fail(error);
  }
}
