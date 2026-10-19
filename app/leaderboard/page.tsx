import type { Metadata } from "next";
import Link from "next/link";
import {
  LEADERBOARD_LIMITATIONS,
  type PublicLeaderboard,
} from "../../lib/leaderboard";
import { leaderboardStore } from "../../lib/server/leaderboard-store";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Anonymous practice leaderboard | Practice Grader",
  robots: { index: false, follow: false },
};
export default async function LeaderboardPage() {
  let board: PublicLeaderboard | null = null;
  try {
    board = await leaderboardStore().publicView();
  } catch {
    /* Display unavailable, never invented or stale rankings. */
  }
  const ranked = board?.cohorts.filter((c) => c.status === "ranked") ?? [];
  return (
    <main className="page-width progress-page growth-page">
      <nav className="growth-nav" aria-label="Leaderboard navigation">
        <Link href="/">Return to the grader</Link>
        <Link href="/benchmarks">Industry benchmarks</Link>
        <Link href="/learn">Practice Foundations</Link>
      </nav>
      <div className="page-heading">
        <div>
          <p className="eyebrow">OPTIONAL ANONYMOUS LEADERBOARD</p>
          <h1>Compare operating readiness with context.</h1>
          <p>
            Choose whether to share one saved assessment under a generated
            alias. Your practice name, website, location and answers stay
            private.
          </p>
        </div>
      </div>
      <section className="card">
        <h2>
          {!board
            ? "The leaderboard is temporarily unavailable."
            : ranked.length
              ? "Current eligible cohorts"
              : "The first cohorts are forming."}
        </h2>
        <p>{LEADERBOARD_LIMITATIONS}</p>
        <p>
          Each cohort uses the same published rubric and groups practices by
          broad stage and fee model. Rankings appear only after at least 10
          explicitly participating workspaces qualify. Smaller counts and scores
          stay hidden. Reports expire from rankings after 90 days, and a new
          rubric starts a separate comparison.
        </p>
        {board && (
          <p>
            Current rubric: {board.releaseLabel}. Completing tasks does not
            change a published score; you choose when to publish a new
            assessment.
          </p>
        )}
        <Link className="btn btn-primary" href="/account">
          Choose a report in your private workspace
        </Link>
      </section>
      {ranked.map((cohort) => (
        <section className="card" key={`${cohort.stage}-${cohort.feeModel}`}>
          <h2>{cohort.label}</h2>
          <p>
            {cohort.entryCount} eligible participating workspaces ·
            owner-reported operating readiness
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Anonymous alias</th>
                  <th scope="col">Readiness / 100</th>
                  <th scope="col">Evidence coverage</th>
                </tr>
              </thead>
              <tbody>
                {cohort.entries.map((entry) => (
                  <tr key={entry.alias}>
                    <td>{entry.rank}</td>
                    <td>{entry.alias}</td>
                    <td>{entry.score}</td>
                    <td>{entry.coveragePercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <section className="card">
        <h2>How to join</h2>
        <ol>
          <li>
            Complete a real assessment with at least 80% evidence coverage and
            all applicable modules scored.
          </li>
          <li>
            Save that report to your verified private account using the current
            published rubric.
          </li>
          <li>
            Preview the score and broad cohort, then separately agree to
            anonymous public publication.
          </li>
        </ol>
        <p>
          Prior interest in a leaderboard does not enroll you. You can withdraw
          in your workspace at any time. Buying Pearl, joining research or
          receiving emails never raises your score.
        </p>
        <Link href="/">
          Open the grader and choose Methodology to review its scoring
        </Link>
      </section>
    </main>
  );
}
