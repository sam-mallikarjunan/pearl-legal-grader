import { requireAccount } from "../../../../lib/server/account-auth";
import {
  accountRouteError,
  ACCOUNT_HEADERS,
} from "../../../../lib/server/account-http";
import { exportAccount } from "../../../../lib/server/account-store";
import { researchStore } from "../../../../lib/server/research-store";
import { exportReportEmails } from "../../../../lib/server/report-email";
import { exportWebsiteAIReviews } from "../../../../lib/server/ai-review";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireAccount(request);
    const [account, helpRequests, reportEmails, websiteExplanations] =
      await Promise.all([
        exportAccount(user.id),
        researchStore().ownRequests(user.id),
        exportReportEmails(user.id),
        exportWebsiteAIReviews(user.id),
      ]);
    return Response.json(
      { ...account, helpRequests, reportEmails, websiteExplanations },
      {
        headers: {
          ...ACCOUNT_HEADERS,
          "Content-Disposition":
            'attachment; filename="pearl-grader-account.json"',
        },
      },
    );
  } catch (error) {
    return accountRouteError(error);
  }
}
