import {
  accountErrorResponse,
  requireOperator,
} from "../../../../../lib/server/account-auth";
import {
  researchErrorResponse,
  ResearchServiceError,
  researchStore,
} from "../../../../../lib/server/research-store";
import { ACCOUNT_HEADERS } from "../../../../../lib/server/account-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireOperator(request);
    const purpose =
      new URL(request.url).searchParams.get("purpose") || "requested_help";
    const store = researchStore();
    const csv = await store.leadCsv(purpose);
    await store.recordExport(
      user.id,
      purpose as "requested_help" | "marketing",
      Math.max(0, csv.split("\r\n").length - 2),
    );
    return new Response(csv, {
      headers: {
        ...ACCOUNT_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=pearl-${purpose === "marketing" ? "marketing-opt-ins" : "requested-help"}.csv`,
      },
    });
  } catch (error) {
    return error instanceof ResearchServiceError
      ? researchErrorResponse(error)
      : accountErrorResponse(error);
  }
}
