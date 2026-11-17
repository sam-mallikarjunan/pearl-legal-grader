import {
  guardAccountMutation,
  requireAccount,
} from "../../../../lib/server/account-auth";
import {
  ACCOUNT_HEADERS,
  accountBody,
  accountRouteError,
} from "../../../../lib/server/account-http";
import { createMonthlyPracticeBriefStore } from "../../../../lib/server/monthly-practice-brief-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireAccount(request);
    return Response.json(
      await createMonthlyPracticeBriefStore().read(user.id),
      {
        headers: ACCOUNT_HEADERS,
      },
    );
  } catch (e) {
    return accountRouteError(e);
  }
}

export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    const decision = await createMonthlyPracticeBriefStore().decide(
      user.id,
      await accountBody(request, 2_000),
    );
    return Response.json({ decision }, { headers: ACCOUNT_HEADERS });
  } catch (e) {
    return accountRouteError(e);
  }
}
