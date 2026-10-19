"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CloudReport } from "../lib/account/types";
import {
  LEADERBOARD_CONSENT_TEXT,
  LEADERBOARD_LIMITATIONS,
  type LeaderboardEnrollment,
} from "../lib/leaderboard";
interface Candidate {
  id: string;
  createdAt: string;
  eligible: boolean;
  score?: number;
  coverage?: number;
  cohortLabel?: string;
  reason?: string;
}
interface OwnState {
  enrollment: LeaderboardEnrollment;
  eligibleReports: Candidate[];
}
export default function LeaderboardEnrollment({
  reports,
}: {
  reports?: CloudReport[];
}) {
  const [state, setState] = useState<OwnState | null>(null);
  const [selected, setSelected] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/account/leaderboard", {
      cache: "no-store",
      signal,
    });
    if (signal?.aborted) return;
    if (response.status === 401) {
      setSignedOut(true);
      setState(null);
      return;
    }
    const body = await response.json();
    if (signal?.aborted) return;
    if (!response.ok)
      throw new Error(
        body.error || "Public sharing choices are temporarily unavailable.",
      );
    setSignedOut(false);
    setState(body);
    setSelected((previous) =>
      body.eligibleReports.some(
        (r: Candidate) => r.id === previous && r.eligible,
      )
        ? previous
        : (body.eligibleReports.find((r: Candidate) => r.eligible)?.id ?? ""),
    );
  }, []);
  const reportKey = reports?.map((r) => r.id).join("|") ?? "";
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((error) => {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : "Public sharing choices are temporarily unavailable.",
        );
    });
    return () => {
      controller.abort();
    };
  }, [reportKey, load]); // The endpoint revalidates eligibility and ownership; prop values never authorize publication.
  async function update(method: "POST" | "DELETE") {
    if (!state) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/leaderboard", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          method === "POST"
            ? {
                reportId: selected,
                revision: state.enrollment.revision,
                consent,
              }
            : { revision: state.enrollment.revision },
        ),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "Your sharing choice could not be saved.",
        );
      setConsent(false);
      await load();
      setMessage(
        method === "DELETE"
          ? "Your entry is withdrawn. It is excluded from new public leaderboard responses immediately."
          : "Your selected score is enrolled under an anonymous alias. It appears publicly only when its cohort has at least 10 eligible entries.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Your sharing choice could not be saved.",
      );
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const choice = state?.eligibleReports.find((r) => r.id === selected);
  const eligible = state?.eligibleReports.filter((r) => r.eligible) ?? [];
  return (
    <section className="card" aria-labelledby="leaderboard-enrollment-title">
      <p className="eyebrow">SEPARATE PUBLIC SHARING CHOICE</p>
      <h2 id="leaderboard-enrollment-title">
        Anonymous operating-readiness leaderboard
      </h2>
      <p>{LEADERBOARD_LIMITATIONS}</p>
      <p>
        Your previous leaderboard-interest preference does not publish anything.
        This separate choice publishes only a generated alias, your selected
        score and evidence coverage within a broad cohort. Names, websites,
        locations and answers stay private.
      </p>
      {signedOut ? (
        <p>
          Sign in above, then return here to choose a saved report.{" "}
          <Link href="/leaderboard">See how the public leaderboard works.</Link>
        </p>
      ) : !state ? (
        message ? (
          <p>
            Your public sharing choices could not be loaded.{" "}
            <button
              className="btn btn-secondary"
              onClick={() => {
                setMessage("");
                load().catch((error) =>
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "Please try again.",
                  ),
                );
              }}
            >
              Try again
            </button>
          </p>
        ) : (
          <p>Loading your public sharing choices…</p>
        )
      ) : (
        <>
          {state.enrollment.published && (
            <div role="status">
              <strong>Enrolled as {state.enrollment.alias}</strong>
              <p>
                Only the report you explicitly selected is used. Later reports
                and action updates do not replace it automatically. A report may
                stop appearing if it expires or the published rubric changes.
              </p>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => update("DELETE")}
              >
                Withdraw my entry
              </button>
            </div>
          )}
          {eligible.length ? (
            <>
              <label htmlFor="leaderboard-report">
                Choose a report to publish
              </label>
              <select
                id="leaderboard-report"
                value={selected}
                disabled={busy}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setConsent(false);
                }}
              >
                {eligible.map((report) => (
                  <option key={report.id} value={report.id}>
                    {new Date(report.createdAt).toLocaleDateString()} ·{" "}
                    {report.score}/100 · {report.cohortLabel}
                  </option>
                ))}
              </select>
              {choice && (
                <p>
                  <strong>Publication preview:</strong> generated anonymous
                  alias · {choice.score}/100 operating readiness ·{" "}
                  {Math.round((choice.coverage ?? 0) * 100)}% coverage ·{" "}
                  {choice.cohortLabel}. Rankings stay hidden until 10 eligible
                  participants join this cohort.
                </p>
              )}
              <label className="growth-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>{LEADERBOARD_CONSENT_TEXT}</span>
              </label>
              <button
                className="btn btn-primary"
                disabled={busy || !consent || !choice?.eligible}
                onClick={() => update("POST")}
              >
                {busy
                  ? "Saving…"
                  : state.enrollment.published
                    ? "Publish this selected report instead"
                    : "Publish anonymously"}
              </button>
            </>
          ) : (
            <p>
              No eligible saved reports yet. Complete and save a non-sample
              report using the current rubric, with at least 80% evidence
              coverage and all applicable modules scored, assessed within 90
              days. <Link href="/">Create an assessment</Link>.
            </p>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
      <p>
        <Link href="/leaderboard">
          View the anonymous leaderboard and joining rules
        </Link>
      </p>
    </section>
  );
}
