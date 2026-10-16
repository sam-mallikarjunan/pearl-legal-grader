import {
  accountErrorResponse,
  boundedAccountBody,
  guardAccountMutation,
  requireAccount,
} from "../../../../lib/server/account-auth";
import {
  researchErrorResponse,
  ResearchServiceError,
  researchStore,
} from "../../../../lib/server/research-store";
import { ACCOUNT_HEADERS } from "../../../../lib/server/account-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireAccount(request);
    return Response.json(
      { requests: await researchStore().ownRequests(user.id) },
      { headers: ACCOUNT_HEADERS },
    );
  } catch (error) {
    return error instanceof ResearchServiceError
      ? researchErrorResponse(error)
      : accountErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    const result = await researchStore().requestHelp(
      user.id,
      await boundedAccountBody(request, 2000),
    );
    return Response.json(result, {
      status: result.created ? 201 : 200,
      headers: ACCOUNT_HEADERS,
    });
  } catch (error) {
    return error instanceof ResearchServiceError
      ? researchErrorResponse(error)
      : accountErrorResponse(error);
  }
}
