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
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    const result = await dataIntegrationStore().reportPlan(
      user.id,
      (await context.params).id,
      await accountBody(request, 1000),
    );
    return Response.json(result, {
      status: result.result.created ? 201 : 200,
      headers: ACCOUNT_HEADERS,
    });
  } catch (error) {
    return dataIntegrationRouteError(error);
  }
}
