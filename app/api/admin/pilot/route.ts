import { requireOperator } from "../../../../lib/server/account-auth";
import {
  ACCOUNT_HEADERS,
  accountRouteError,
} from "../../../../lib/server/account-http";
import { createPilotStore } from "../../../../lib/server/pilot-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireOperator(request);
    return Response.json(
      { summary: await createPilotStore().summary() },
      {
        headers: ACCOUNT_HEADERS,
      },
    );
  } catch (error) {
    return accountRouteError(error);
  }
}
