import {
  DataIntegrationError,
  dataIntegrationBearer,
} from "../../../../lib/data-integrations";
import {
  accountBody,
  ACCOUNT_HEADERS,
} from "../../../../lib/server/account-http";
import { dataIntegrationStore } from "../../../../lib/server/data-integration-store";
import { dataIntegrationRouteError } from "../../../../lib/server/data-integration-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(r: Request) {
  try {
    if (r.headers.has("origin"))
      throw new DataIntegrationError(
        "server_delivery_only",
        "Use a server-to-server automation request.",
        403,
      );
    dataIntegrationBearer(r.headers.get("authorization"));
    const result = await dataIntegrationStore().receive(
      r.headers.get("authorization"),
      await accountBody(r, 64000),
    );
    return Response.json(result, {
      status: result.duplicate ? 200 : 202,
      headers: ACCOUNT_HEADERS,
    });
  } catch (e) {
    return dataIntegrationRouteError(e);
  }
}
