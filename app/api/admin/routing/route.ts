import {
  requireOperator,
  accountErrorResponse,
} from "../../../../lib/server/account-auth";
import { ACCOUNT_HEADERS } from "../../../../lib/server/account-http";
import {
  leadRoutingStore,
  LeadRoutingError,
  leadRoutingErrorResponse,
} from "../../../../lib/server/lead-routing-store";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireOperator(request);
    return Response.json(await leadRoutingStore().queue(), {
      headers: ACCOUNT_HEADERS,
    });
  } catch (error) {
    return error instanceof LeadRoutingError
      ? leadRoutingErrorResponse(error)
      : accountErrorResponse(error);
  }
}
