import {
  requireAccount,
  guardAccountMutation,
} from "../../../../lib/server/account-auth";
import {
  accountBody,
  accountRouteError,
  ACCOUNT_HEADERS,
} from "../../../../lib/server/account-http";
import {
  listAccountReports,
  saveAccountReport,
} from "../../../../lib/server/account-store";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireAccount(request);
    return Response.json(
      { reports: await listAccountReports(user.id) },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return accountRouteError(error);
  }
}
export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    const result = await saveAccountReport(user.id, await accountBody(request));
    return Response.json(result, {
      status: result.created ? 201 : 200,
      headers: ACCOUNT_HEADERS,
    });
  } catch (error) {
    return accountRouteError(error);
  }
}
