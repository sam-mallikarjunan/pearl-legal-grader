import {
  guardAccountMutation,
  requireAccount,
} from "../../../../../../lib/server/account-auth";
import {
  accountBody,
  ACCOUNT_HEADERS,
} from "../../../../../../lib/server/account-http";
import { dataIntegrationStore } from "../../../../../../lib/server/data-integration-store";
import { dataIntegrationRouteError } from "../../../../../../lib/server/data-integration-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  r: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardAccountMutation(r);
    const user = await requireAccount(r);
    const result = await dataIntegrationStore().accept(
      user.id,
      (await context.params).id,
      await accountBody(r, 1000),
    );
    return Response.json(result, {
      status: result.result.created ? 201 : 200,
      headers: ACCOUNT_HEADERS,
    });
  } catch (e) {
    return dataIntegrationRouteError(e);
  }
}
