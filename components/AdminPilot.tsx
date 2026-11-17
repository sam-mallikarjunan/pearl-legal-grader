"use client";

import { useEffect, useState } from "react";
import {
  PILOT_BLOCKERS,
  PILOT_LINK,
  type PilotBlocker,
  type PilotSummary,
} from "../lib/pilot-learning";
import "./published-admin.css";
import "./pilot-learning.css";

type Access = "loading" | "allowed" | "sign_in" | "forbidden" | "error";

export default function AdminPilot() {
  const [data, setData] = useState<PilotSummary | null>(null);
  const [access, setAccess] = useState<Access>("loading");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setAccess("loading");
      setData(null);
      try {
        const response = await fetch("/api/admin/pilot", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          setAccess(response.status === 401 ? "sign_in" : "forbidden");
          return;
        }
        if (!response.ok) throw new Error("Pilot summary unavailable.");
        const result = (await response.json()) as { summary: PilotSummary };
        if (controller.signal.aborted) return;
        setData(result.summary);
        setAccess("allowed");
      } catch {
        if (!controller.signal.aborted) setAccess("error");
      }
    }
    void load();
    return () => controller.abort();
  }, [reload]);

  const details = data?.details;
  return (
    <main className="published-admin">
      <header className="pa-heading">
        <div>
          <p className="pa-eyebrow">PEARL PRACTICE GRADER · OPERATOR VIEW</p>
          <h1>First improvement pilot</h1>
          <p>See where volunteer workspaces make progress or get stuck.</p>
        </div>
        <a href="/admin/insights">Learning and requested help</a>
      </header>
      {access === "loading" && (
        <p role="status">Checking administrator access…</p>
      )}
      {access === "sign_in" && (
        <section className="pa-card">
          <h2>Sign in to continue</h2>
          <p>A verified administrator account is required.</p>
          <a href="/account?next=/admin">Open account sign-in</a>
        </section>
      )}
      {access === "forbidden" && (
        <section className="pa-card">
          <h2>Administrator access required</h2>
          <a href="/account">Back to your account</a>
        </section>
      )}
      {access === "error" && (
        <section className="pa-card">
          <p role="alert">The pilot summary could not load.</p>
          <button type="button" onClick={() => setReload((v) => v + 1)}>
            Try again
          </button>
        </section>
      )}
      {access === "allowed" && data && (
        <>
          <section className="pa-card">
            <h2>Current participants</h2>
            <p className="pilot-primary-metric">
              <strong>
                {data.enrolled} of {data.capacity}
              </strong>{" "}
              places filled
            </p>
            <p>
              One count per signed-in workspace that explicitly joined from the
              pilot link. This is not an invitation response rate or a count of
              all grader users. Leaving removes the participant’s data from
              future counts.
            </p>
            <div className="pa-buttons">
              <a href={PILOT_LINK}>Open the pilot invitation link</a>
              <button type="button" onClick={() => setReload((v) => v + 1)}>
                Refresh summary
              </button>
            </div>
            <p className="pa-note">
              Share the link privately with the intended cohort. The link tags a
              volunteer group; it does not verify who was personally invited.
            </p>
            {!details && (
              <p>
                Progress and feedback detail are withheld until{" "}
                {data.minimumForDetail} workspaces participate.
              </p>
            )}
          </section>
          {details && (
            <>
              <section className="pa-card">
                <h2>Progress</h2>
                <dl className="pilot-summary-grid">
                  <div>
                    <dt>Saved report available</dt>
                    <dd>
                      {details.reportsAvailable} / {data.enrolled}
                    </dd>
                    <p>Includes a current report saved before joining.</p>
                  </div>
                  <div>
                    <dt>Saved a report since joining</dt>
                    <dd>
                      {details.reportsSavedSinceJoining} / {data.enrolled}
                    </dd>
                    <p>Counts current reports that were saved after opt-in.</p>
                  </div>
                  <div>
                    <dt>Report and action chosen</dt>
                    <dd>
                      {details.savedReportAndActionChosen} / {data.enrolled}
                    </dd>
                    <p>
                      Same saved report with an action marked started or done
                      since joining, or tracked prospectively.
                    </p>
                  </div>
                  <div>
                    <dt>New follow-up plan</dt>
                    <dd>
                      {details.newPlans} / {data.enrolled}
                    </dd>
                    <p>
                      Current future-month plan created since joining; it may
                      already have closed.
                    </p>
                  </div>
                  <div>
                    <dt>Tracking with an intact baseline</dt>
                    <dd>
                      {details.eligibleTracking} / {data.enrolled}
                    </dd>
                    <p>
                      First retained action registration since joining, with the
                      original report, baseline revision, and plan.
                    </p>
                  </div>
                </dl>
                <p className="pa-note">
                  These counts describe current records. They are not a
                  step-by-step funnel; users can enter with a report or a plan.
                </p>
              </section>
              <section className="pa-card">
                <h2>Follow-up after the planned month</h2>
                <dl className="pilot-summary-grid">
                  <div>
                    <dt>Eligible windows that closed</dt>
                    <dd>
                      {details.elapsedWindows} / {details.eligibleTracking}
                    </dd>
                  </div>
                  <div>
                    <dt>Exact plan reported</dt>
                    <dd>
                      {details.elapsedWindows
                        ? `${details.exactFollowups} / ${details.elapsedWindows}`
                        : "No eligible closed windows"}
                    </dd>
                  </div>
                  <div>
                    <dt>Comparable follow-up</dt>
                    <dd>
                      {details.elapsedWindows
                        ? `${details.comparableFollowups} / ${details.elapsedWindows}`
                        : "No eligible closed windows"}
                    </dd>
                  </div>
                </dl>
                <p className="pa-note">
                  Months close in UTC. Only the linked follow-up for the first
                  retained registration counts. A revised baseline, withdrawn
                  plan, incompatible follow-up, or unknown metric is not
                  replaced with another period. These are private observations,
                  not evidence that an action caused a change.
                </p>
              </section>
              <section className="pa-card">
                <h2>What participants reported</h2>
                <dl className="pilot-summary-grid">
                  <div>
                    <dt>Answered about usefulness</dt>
                    <dd>
                      {details.usefulnessResponses} / {data.enrolled}
                    </dd>
                  </div>
                  <div>
                    <dt>Found a useful next step</dt>
                    <dd>
                      {details.usefulnessResponses
                        ? `${details.usefulResponses} / ${details.usefulnessResponses}`
                        : "No responses"}
                    </dd>
                  </div>
                  <div>
                    <dt>Median time until “useful”</dt>
                    <dd>
                      {details.medianMinutesToUseful === null
                        ? "Withheld"
                        : `About ${details.medianMinutesToUseful} min`}
                    </dd>
                    <p>
                      Elapsed since joining; rounded to 5 minutes with at least
                      5 retained useful responses.
                    </p>
                  </div>
                  <div>
                    <dt>Answered about a blocker</dt>
                    <dd>
                      {details.blockerResponses} / {data.enrolled}
                    </dd>
                  </div>
                </dl>
                {Object.entries(details.commonBlockers).length ? (
                  <ul>
                    {Object.entries(details.commonBlockers).map(([key, n]) => (
                      <li key={key}>
                        {PILOT_BLOCKERS[key as PilotBlocker]}: {n} /{" "}
                        {details.blockerResponses}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pa-note">
                    No blocker category meets the disclosure minimum.
                  </p>
                )}
                <p className="pa-note">
                  Blocker categories are shown only when at least three
                  respondents chose the category and at least three chose
                  another.
                </p>
              </section>
              <section className="pa-card">
                <h2>Separately requested Pearl help</h2>
                <p>
                  <strong>
                    {details.helpRequests} / {data.enrolled}
                  </strong>{" "}
                  workspaces with a current consented request created since
                  joining.
                </p>
                <p className="pa-note">
                  A request is not a qualified conversation, attended
                  consultation, or payment. The pilot does not enroll anyone in
                  contact or email.
                </p>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
