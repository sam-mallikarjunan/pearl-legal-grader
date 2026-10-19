import {
  accountAdminClient,
  accountClient,
  accountErrorResponse,
  AccountAuthError,
  boundedAccountBody,
  guardAccountMutation,
  requireAccount,
  requireRecentAccountAuthentication,
} from "../../../lib/server/account-auth";
export const runtime = "nodejs";
export async function DELETE(request: Request) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    const body = await boundedAccountBody(request);
    if (body.confirm !== "DELETE MY ACCOUNT")
      throw new AccountAuthError(
        400,
        "Type DELETE MY ACCOUNT to confirm deletion.",
      );
    const client = await accountClient();
    await requireRecentAccountAuthentication(client.auth, user.id);
    const deleted = await accountAdminClient().auth.admin.deleteUser(user.id);
    if (deleted.error)
      throw new AccountAuthError(
        503,
        "Your account could not be deleted. Please try again later.",
      );
    await client.auth.signOut({ scope: "global" });
    return Response.json(
      {
        ok: true,
        message:
          "Your account and private workspace were deleted. Device copies can be cleared separately. Shared public website checks keep their own 30-day expiry; provider delivery logs and backups follow provider retention.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return accountErrorResponse(error);
  }
}
