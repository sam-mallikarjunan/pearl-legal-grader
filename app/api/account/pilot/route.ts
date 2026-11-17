import {
  guardAccountMutation,
  requireAccount,
} from "../../../../lib/server/account-auth";
import {
  ACCOUNT_HEADERS,
  accountBody,
  accountRouteError,
} from "../../../../lib/server/account-http";
import { createPilotStore } from "../../../../lib/server/pilot-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function response(
  request: Request,
  operation: "participation" | "join" | "feedback" | "leave",
) {
  try {
    if (operation !== "participation") guardAccountMutation(request);
    const user = await requireAccount(request);
    const store = createPilotStore();
    const participation =
      operation === "participation"
        ? await store.participation(user.id)
        : await store[operation](user.id, await accountBody(request, 1024));
    return Response.json({ participation }, { headers: ACCOUNT_HEADERS });
  } catch (error) {
    return accountRouteError(error);
  }
}

export function GET(request: Request) {
  return response(request, "participation");
}
export function POST(request: Request) {
  return response(request, "join");
}
export function PATCH(request: Request) {
  return response(request, "feedback");
}
export function DELETE(request: Request) {
  return response(request, "leave");
}
