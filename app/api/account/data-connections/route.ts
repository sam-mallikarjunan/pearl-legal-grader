import {
  accountClient,
  AccountAuthError,
  guardAccountMutation,
  requireAccount,
  requireRecentAccountAuthentication,
} from "../../../../lib/server/account-auth";
import {
  accountBody,
  ACCOUNT_HEADERS,
} from "../../../../lib/server/account-http";
import { DataIntegrationError } from "../../../../lib/data-integrations";
import { dataIntegrationStore } from "../../../../lib/server/data-integration-store";
import { dataIntegrationRouteError } from "../../../../lib/server/data-integration-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  try {
    const user = await requireAccount(r);
    return Response.json(
      { connections: await dataIntegrationStore().connections(user.id) },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (e) {
    return dataIntegrationRouteError(e);
  }
}
export async function POST(r: Request) {
  try {
    guardAccountMutation(r);
    const user = await requireAccount(r);
    const body = await accountBody(r, 1000);
    const client = await accountClient();
    try {
      await requireRecentAccountAuthentication(client.auth, user.id);
    } catch (e) {
      if (e instanceof AccountAuthError && e.status === 403)
        throw new DataIntegrationError(
          "recent_signin_required",
          "Sign in again with a new code before creating a connection key.",
          403,
        );
      throw e;
    }
    return Response.json(await dataIntegrationStore().create(user.id, body), {
      status: 201,
      headers: ACCOUNT_HEADERS,
    });
  } catch (e) {
    return dataIntegrationRouteError(e);
  }
}
