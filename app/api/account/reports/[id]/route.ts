import {
  requireAccount,
  guardAccountMutation,
} from "../../../../../lib/server/account-auth";
import {
  accountRouteError,
  ACCOUNT_HEADERS,
} from "../../../../../lib/server/account-http";
import {
  deleteAccountReport,
  readAccountReport,
} from "../../../../../lib/server/account-store";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireAccount(request);
    return Response.json(
      { report: await readAccountReport(user.id, (await context.params).id) },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return accountRouteError(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    await deleteAccountReport(user.id, (await context.params).id);
    return Response.json({ deleted: true }, { headers: ACCOUNT_HEADERS });
  } catch (error) {
    return accountRouteError(error);
  }
}
