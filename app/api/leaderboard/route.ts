import {
  leaderboardStore,
  LeaderboardServiceError,
  leaderboardErrorResponse,
} from "../../../lib/server/leaderboard-store";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(await leaderboardStore().publicView(), {
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return leaderboardErrorResponse(
      error instanceof LeaderboardServiceError
        ? error
        : new LeaderboardServiceError(),
    );
  }
}
