import {
  guardAccountMutation,
  requireAccount,
} from "../../../../../lib/server/account-auth";
import {
  accountBody,
  accountRouteError,
  ACCOUNT_HEADERS,
} from "../../../../../lib/server/account-http";
import { OutcomeInputError } from "../../../../../lib/outcomes";
import {
  importOwnOutcomes,
  OutcomeImportStorageError,
} from "../../../../../lib/server/outcome-import-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    const user = await requireAccount(request);
    const result = await importOwnOutcomes(
      user.id,
      await accountBody(request, 64000),
    );
    return Response.json(result, {
      status: result.created ? 201 : 200,
      headers: ACCOUNT_HEADERS,
    });
  } catch (error) {
    return error instanceof OutcomeInputError ||
      error instanceof OutcomeImportStorageError
      ? Response.json(
          { code: error.code, error: error.message },
          { status: error.status, headers: ACCOUNT_HEADERS },
        )
      : accountRouteError(error);
  }
}
