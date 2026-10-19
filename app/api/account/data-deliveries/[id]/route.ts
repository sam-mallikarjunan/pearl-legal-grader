import {
  guardAccountMutation,
  requireAccount,
} from "../../../../../lib/server/account-auth";
import {
  accountBody,
  ACCOUNT_HEADERS,
} from "../../../../../lib/server/account-http";
import { dataIntegrationStore } from "../../../../../lib/server/data-integration-store";
import { dataIntegrationRouteError } from "../../../../../lib/server/data-integration-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  r: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAccount(r);
    return Response.json(
      {
        delivery: await dataIntegrationStore().delivery(
          user.id,
          (await context.params).id,
        ),
      },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (e) {
    return dataIntegrationRouteError(e);
  }
}
export async function DELETE(
  r: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardAccountMutation(r);
    const user = await requireAccount(r);
    return Response.json(
      {
        delivery: await dataIntegrationStore().discard(
          user.id,
          (await context.params).id,
          await accountBody(r, 1000),
        ),
      },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (e) {
    return dataIntegrationRouteError(e);
  }
}
