import { requireAccount } from "../../../../lib/server/account-auth";
import {
  accountRouteError,
  ACCOUNT_HEADERS,
} from "../../../../lib/server/account-http";
import { exportAccount } from "../../../../lib/server/account-store";
import { researchStore } from "../../../../lib/server/research-store";
import { exportReportEmails } from "../../../../lib/server/report-email";
import { exportWebsiteAIReviews } from "../../../../lib/server/ai-review";
import { leaderboardStore } from "../../../../lib/server/leaderboard-store";
import { exportOwnNurture } from "../../../../lib/server/nurture-store";
import { exportOwnOutcomes } from "../../../../lib/server/outcome-store";
import { leadRoutingStore } from "../../../../lib/server/lead-routing-store";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireAccount(request);
    const [
      account,
      helpRequests,
      reportEmails,
      websiteExplanations,
      leaderboard,
      nurture,
      outcomes,
      requestedContactAccess,
    ] = await Promise.all([
      exportAccount(user.id),
      researchStore().ownRequests(user.id),
      exportReportEmails(user.id),
      exportWebsiteAIReviews(user.id),
      leaderboardStore().exportOwn(user.id),
      exportOwnNurture(user.id),
      exportOwnOutcomes(user.id),
      leadRoutingStore().exportOwn(user.id),
    ]);
    return Response.json(
      {
        ...account,
        helpRequests,
        reportEmails,
        websiteExplanations,
        leaderboard,
        nurture,
        outcomes,
        requestedContactAccess,
      },
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
