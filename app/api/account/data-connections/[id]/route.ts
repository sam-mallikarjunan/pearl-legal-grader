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
export async function DELETE(
  r: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardAccountMutation(r);
    const user = await requireAccount(r);
    const connection = await dataIntegrationStore().revoke(
      user.id,
      (await context.params).id,
      await accountBody(r, 1000),
    );
    return Response.json({ connection }, { headers: ACCOUNT_HEADERS });
  } catch (e) {
    return dataIntegrationRouteError(e);
  }
}
