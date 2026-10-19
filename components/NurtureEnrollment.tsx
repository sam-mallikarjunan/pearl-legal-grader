"use client";
import { useCallback, useEffect, useId, useState } from "react";
import {
  NURTURE_CONSENT_TEXT,
  NURTURE_LESSONS,
  NURTURE_SERIES_VERSION,
  type NurtureAccountState,
} from "../lib/nurture";

export default function NurtureEnrollment({
  onPreferencesChanged,
}: {
  onPreferencesChanged?: () => void | Promise<void>;
}) {
  const id = useId();
  const [state, setState] = useState<NurtureAccountState | null>(null);
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account/nurture", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "The email series could not load.");
      setState(data);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The email series could not load.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function change(enroll: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/nurture", {
        method: enroll ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        ...(enroll
          ? {
              body: JSON.stringify({
                seriesVersion: NURTURE_SERIES_VERSION,
                consent,
                marketingConsent: consent,
              }),
            }
          : {}),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error || "The email preference could not be saved.",
        );
      setState(data);
      setConsent(false);
      setMessage(
        enroll
          ? "You’re enrolled. The first lesson is scheduled, followed by lessons about a week apart. Timing can vary with capacity and delivery."
          : "The series and grader marketing emails are stopped. Email already accepted for delivery may still arrive.",
      );
      await onPreferencesChanged?.();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The email preference could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="practice-learning"
      className="account-subsection"
      aria-labelledby={`${id}-heading`}
      style={{
        borderTop: "1px solid var(--border, #d9e3df)",
        paddingTop: 24,
        marginTop: 24,
      }}
    >
      <p className="eyebrow">OPTIONAL · FOUR EMAILS</p>
      <h3 id={`${id}-heading`}>Build your practice foundations</h3>
      <p>
        A weekly, practical lesson on intake, conversion, cash collection and a
        repeatable operating rhythm. You can read the lessons without
        subscribing, and your grade stays the same.
      </p>
      <details>
        <summary>Preview the four lessons</summary>
        <ol>
          {NURTURE_LESSONS.map((lesson) => (
            <li key={lesson.step} style={{ marginBottom: 16 }}>
              <strong>{lesson.title}</strong>
              <p>{lesson.action}</p>
            </li>
          ))}
        </ol>
      </details>
      {state?.enrollment ? (
        <>
          <p>
            <strong>Series: {state.enrollment.status}</strong> ·{" "}
            {state.enrollment.messagesAccepted} of 4 accepted for sending ·{" "}
            {state.enrollment.messagesDelivered} delivered.
          </p>
          {state.enrollment.status === "active" ? (
            <>
              <p>
                {state.paused
                  ? "Sending is temporarily paused."
                  : state.enrollment.nextSendAt
                    ? `Next lesson scheduled from ${new Date(state.enrollment.nextSendAt).toLocaleDateString()}.`
                    : "The next lesson will be scheduled after the current email is accepted."}
              </p>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void change(false)}
              >
                {busy ? "Saving…" : "Stop series and marketing emails"}
              </button>
            </>
          ) : (
            <p>
              This series will not restart automatically. Your dashboard and
              requested report emails remain available.
            </p>
          )}
        </>
      ) : state?.available && !state.paused ? (
        <>
          <label
            htmlFor={`${id}-consent`}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              margin: "20px 0",
            }}
          >
            <input
              id={`${id}-consent`}
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(event) => setConsent(event.target.checked)}
              style={{ marginTop: 5, flex: "0 0 auto" }}
            />
            <span>{NURTURE_CONSENT_TEXT}</span>
          </label>
          <button
            className="btn btn-primary"
            disabled={!consent || busy}
            onClick={() => void change(true)}
          >
            {busy ? "Saving…" : "Send me the four-part series"}
          </button>
        </>
      ) : (
        <p>
          {state
            ? "Email enrollment is temporarily paused. The lesson previews and your dashboard remain available."
            : "Loading email preferences…"}
        </p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}

interface Operations {
  enabled: boolean;
  paused: boolean;
  revision: number;
  enrollments: Record<string, number>;
  delivery: Record<string, number>;
  usage: { day: number; month: number };
}
export function AdminNurture() {
  const id = useId();
  const [data, setData] = useState<Operations | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/nurture", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Nurture operations are unavailable.");
      setData(result);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Nurture operations are unavailable.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function toggle() {
    if (!data) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/nurture", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: data.revision,
          paused: !data.paused,
          reason,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "The pause setting could not be saved.",
        );
      setData(result);
      setReason("");
      setMessage(
        result.paused
          ? "Future nurture sends are paused."
          : "Nurture scheduling resumed for explicitly enrolled accounts.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The pause setting could not be saved.",
      );
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function dispatch() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/nurture/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DISPATCH DUE LESSONS" }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "The due lessons could not be queued.");
      setMessage(
        `${result.queued} due lesson(s) queued; ${result.deferred} deferred for retry. Provider acceptance and delivery are checked separately.`,
      );
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The due lessons could not be queued.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="account-subsection"
      aria-labelledby={`${id}-heading`}
      style={{
        borderTop: "1px solid var(--border, #d9e3df)",
        marginTop: 32,
        paddingTop: 24,
      }}
    >
      <h2 id={`${id}-heading`}>Practice Foundations email operations</h2>
      <p>
        Only the new, explicit four-part enrollment starts this series. General
        marketing consent alone never starts email.
      </p>
      {data ? (
        <>
          <p>
            Configuration:{" "}
            <strong>{data.enabled ? "enabled" : "disabled"}</strong> ·
            Scheduler: <strong>{data.paused ? "paused" : "running"}</strong>
          </p>
          <p>
            Reserved messages: {data.usage.day}/50 today · {data.usage.month}
            /500 this month. At most 20 messages per scheduler batch.
          </p>
          <dl>
            {Object.entries(data.enrollments).map(([status, count]) => (
              <div key={`enroll-${status}`}>
                <dt>Enrollments: {status}</dt>
                <dd>{count}</dd>
              </div>
            ))}
            {Object.entries(data.delivery).map(([status, count]) => (
              <div key={`delivery-${status}`}>
                <dt>Messages: {status}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <p>
            Queued, provider-accepted and delivered are distinct states. A pause
            cannot recall email already accepted for delivery. Templates are
            immutable in this release; new wording requires a new reviewed
            version.
          </p>
          <label htmlFor={`${id}-reason`}>
            Reason for {data.paused ? "resuming" : "pausing"}
          </label>
          <input
            id={`${id}-reason`}
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            style={{
              display: "block",
              maxWidth: "100%",
              width: 480,
              margin: "8px 0 16px",
            }}
          />
          <button
            className="btn btn-secondary"
            disabled={busy || reason.trim().length < 8}
            onClick={() => void toggle()}
          >
            {busy
              ? "Saving…"
              : data.paused
                ? "Resume nurture scheduling"
                : "Pause nurture scheduling"}
          </button>
          <p>
            Dispatch sends the next due lesson to up to 20 currently enrolled
            accounts, using the same consent checks, limits and idempotency as
            the daily scheduler.
          </p>
          <button
            className="btn btn-secondary"
            disabled={busy || data.paused || !data.enabled}
            onClick={() => void dispatch()}
          >
            Queue due lessons now
          </button>
        </>
      ) : (
        <p>Loading operations…</p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
