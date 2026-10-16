import {
  accountClient,
  accountErrorResponse,
  guardAccountMutation,
} from "../../../../lib/server/account-auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    const client = await accountClient();
    await client.auth.signOut({ scope: "local" });
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return accountErrorResponse(error);
  }
}
