"use client";

import { useEffect, useRef, useState } from "react";
import {
  PILOT_BLOCKERS,
  PILOT_COHORT,
  PILOT_USEFULNESS,
  type PilotBlocker,
  type PilotParticipation,
  type PilotUsefulness,
} from "../lib/pilot-learning";
import "./pilot-learning.css";

const DEFAULT_ERROR = "Pilot participation could not load. Try again shortly.";

export default function PilotParticipation() {
  const anchored = useRef(false);
  const [offered, setOffered] = useState(false);
  const [participation, setParticipation] = useState<PilotParticipation | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [stayedVisible, setStayedVisible] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [usefulness, setUsefulness] = useState<PilotUsefulness | "">("");
  const [blocker, setBlocker] = useState<PilotBlocker | "">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setOffered(
      new URL(window.location.href).searchParams.get("pilot") === PILOT_COHORT,
    );
    const controller = new AbortController();
    async function load() {
      setReady(false);
      setError("");
      try {
        const response = await fetch("/api/account/pilot", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(DEFAULT_ERROR);
        const { participation: row } = (await response.json()) as {
          participation: PilotParticipation | null;
        };
        if (controller.signal.aborted) return;
        setParticipation(row);
        setUsefulness(row?.usefulness ?? "");
        setBlocker(row?.blocker ?? "");
        if (row) setStayedVisible(true);
        setReady(true);
      } catch {
        if (!controller.signal.aborted) setError(DEFAULT_ERROR);
      }
    }
    void load();
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (
      !offered ||
      anchored.current ||
      window.location.hash !== "#first-improvement-pilot"
    )
      return;
    const section = document.getElementById("first-improvement-pilot");
    if (!section) return;
    anchored.current = true;
    section.scrollIntoView();
  }, [offered]);

  async function change(
    method: "POST" | "PATCH" | "DELETE",
    payload: Record<string, unknown>,
    success: string,
  ) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/account/pilot", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: { participation: PilotParticipation | null; code?: string } =
        await response.json();
      if (!response.ok) {
        if (body.code === "pilot_changed") {
          setReady(false);
          throw new Error(
            "Your pilot record changed in another session. Refresh it before you continue.",
          );
        }
        if (body.code === "pilot_capacity")
          throw new Error(
            "The pilot is currently full. You can still use the grader.",
          );
        throw new Error("Your choice could not be saved. Try again shortly.");
      }
      setParticipation(body.participation);
      setStayedVisible(true);
      setUsefulness(body.participation?.usefulness ?? "");
      setBlocker(body.participation?.blocker ?? "");
      setConfirmed(false);
      setConfirmLeave(false);
      setMessage(success);
    } catch (cause) {
      setError(
        cause instanceof Error &&
          [
            "Your pilot record changed in another session. Refresh it before you continue.",
            "The pilot is currently full. You can still use the grader.",
            "Your choice could not be saved. Try again shortly.",
          ].includes(cause.message)
          ? cause.message
          : "Your choice could not be saved. Try again shortly.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!offered && !participation && !stayedVisible) return null;
  return (
    <section
      id="first-improvement-pilot"
      className="pilot-participation"
      aria-labelledby="pilot-participation-title"
    >
      <p className="eyebrow">OPTIONAL PILOT</p>
      <h3 id="pilot-participation-title">Help improve the grader</h3>
      <p>
        This small pilot tracks whether people can save a report, pick an
        action, and come back after a planned reporting month.
      </p>
      <p>
        If you join, Pearl operators see group counts of those steps, optional
        feedback, and whether people separately asked for Pearl’s help. The
        pilot view does not show your identity, report answers, or business
        totals. Joining does not sign you up for emails, benchmarking, public
        sharing, or sales contact. You can leave any time.
      </p>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {!ready && !error && <p role="status">Checking pilot participation…</p>}
      {!ready && error && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setReload((v) => v + 1)}
        >
          Refresh participation
        </button>
      )}
      {ready && !participation && offered && (
        <div className="pilot-actions">
          <label className="pilot-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I agree to include my workspace’s progress and optional feedback in
            the pilot’s group counts.
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!confirmed || busy}
            onClick={() =>
              void change(
                "POST",
                { cohort: PILOT_COHORT, confirm: true },
                "You joined the pilot.",
              )
            }
          >
            Join the pilot
          </button>
        </div>
      )}
      {ready && participation && (
        <>
          <p>
            <strong>You’re participating.</strong>{" "}
            <a href="#first-improvement">Go to your first improvement</a>
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void change(
                "PATCH",
                {
                  joinedAt: participation.joinedAt,
                  revision: participation.revision,
                  usefulness: usefulness || null,
                  blocker: blocker || null,
                },
                "Your feedback was saved.",
              );
            }}
          >
            <div className="pilot-inputs">
              <label>
                Have you found a useful next step?
                <select
                  value={usefulness}
                  disabled={busy}
                  onChange={(e) =>
                    setUsefulness(e.target.value as PilotUsefulness | "")
                  }
                >
                  <option value="">Leave unanswered</option>
                  {Object.entries(PILOT_USEFULNESS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                What’s getting in the way?
                <select
                  value={blocker}
                  disabled={busy}
                  onChange={(e) =>
                    setBlocker(e.target.value as PilotBlocker | "")
                  }
                >
                  <option value="">Leave unanswered</option>
                  {Object.entries(PILOT_BLOCKERS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="pilot-actions">
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={
                  busy ||
                  (usefulness === (participation.usefulness ?? "") &&
                    blocker === (participation.blocker ?? ""))
                }
              >
                Save optional feedback
              </button>
              {!confirmLeave && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => setConfirmLeave(true)}
                >
                  Leave the pilot
                </button>
              )}
            </div>
          </form>
          {confirmLeave && (
            <div className="pilot-leave">
              <p>
                Leave the pilot and remove your feedback from future group
                counts? Your reports, plans, and other choices stay as they are.
              </p>
              <div className="pilot-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    void change(
                      "DELETE",
                      { joinedAt: participation.joinedAt, confirm: true },
                      "You left the pilot. Your feedback was removed.",
                    )
                  }
                >
                  Confirm leaving the pilot
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => setConfirmLeave(false)}
                >
                  Keep participating
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
