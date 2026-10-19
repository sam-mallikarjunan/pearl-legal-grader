import { requireAccount } from "../../../../lib/server/account-auth";
import { ACCOUNT_HEADERS } from "../../../../lib/server/account-http";
import { dataIntegrationStore } from "../../../../lib/server/data-integration-store";
import { dataIntegrationRouteError } from "../../../../lib/server/data-integration-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  try {
    const user = await requireAccount(r);
    return Response.json(
      { deliveries: await dataIntegrationStore().deliveries(user.id) },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (e) {
    return dataIntegrationRouteError(e);
  }
}
