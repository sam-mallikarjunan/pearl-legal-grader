"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  REPORTING_REMINDER_CONSENT,
  REPORTING_REMINDER_VERSION,
  type ReportingReminderState,
} from "../lib/reporting-reminders";
export default function OutcomeReminders() {
  const id = useId(),
    sampleId = useRef<string | null>(null);
  const [data, setData] = useState<ReportingReminderState | null>(null),
    [granted, setGranted] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/account/outcome-reminders", {
          cache: "no-store",
        }),
        v = await r.json();
      if (!r.ok)
        throw new Error(v.error || "Reminder settings could not load.");
      setData(v);
      setGranted(v.preference.granted);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Reminder settings could not load.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function save() {
    if (!data) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/account/outcome-reminders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            granted,
            revision: data.preference.revision,
            consentVersion: REPORTING_REMINDER_VERSION,
          }),
        }),
        v = await r.json();
      if (!r.ok)
        throw new Error(v.error || "Reminder permission could not save.");
      setData(v);
      setGranted(v.preference.granted);
      sampleId.current = null;
      setMessage(
        v.preference.granted
          ? "Outcome-reporting reminders are enabled for your verified account email."
          : "Only outcome-reporting reminders are stopped. Other permissions are unchanged.",
      );
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Reminder permission could not save.",
      );
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function sample() {
    setBusy(true);
    setMessage("");
    if (!sampleId.current) sampleId.current = crypto.randomUUID();
    try {
      const r = await fetch("/api/account/outcome-reminders/sample", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: sampleId.current,
            confirm: "SEND SAMPLE REMINDER",
          }),
        }),
        v = await r.json();
      if (!r.ok)
        throw new Error(v.error || "Sample reminder could not be requested.");
      setMessage(
        v.alreadyRequested
          ? "This sample was already requested. No additional email or workflow was queued; refresh its delivery history below."
          : v.queued
            ? "Your labeled sample is queued. Provider acceptance and delivery are separate states; refresh below to see delivery."
            : "Your sample is saved and waiting for dispatch. Refresh its status before requesting again.",
      );
      await load();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Sample reminder could not be requested.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="outcome-reporting-reminders"
      className="account-subsection"
      aria-labelledby={`${id}-title`}
    >
      <p className="eyebrow">OPTIONAL · REPORTING REMINDERS</p>
      <h3 id={`${id}-title`}>A nudge when your planned month closes</h3>
      <p>
        Reminders are off until you choose this specific permission. A plan must
        have been registered in advance; no reporting dates are changed to send
        email.
      </p>
      {data ? (
        <>
          <label className="preference" htmlFor={`${id}-choice`}>
            <input
              id={`${id}-choice`}
              type="checkbox"
              checked={granted}
              disabled={busy || (!data.available && !data.preference.granted)}
              onChange={(e) => setGranted(e.target.checked)}
            />
            <span>{REPORTING_REMINDER_CONSENT}</span>
          </label>
          {(!data.available || data.paused) && (
            <p>
              Sending is currently paused. You can still turn these reminders
              off.
            </p>
          )}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 16,
            }}
          >
            <button
              className="btn btn-secondary"
              disabled={busy || granted === data.preference.granted}
              onClick={() => void save()}
            >
              Save reporting-reminder permission
            </button>
            <button
              className="btn btn-secondary"
              disabled={
                busy ||
                !data.available ||
                data.paused ||
                !data.preference.granted
              }
              onClick={() => void sample()}
            >
              Send me a sample reminder
            </button>
            <button
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              Refresh reminder delivery
            </button>
          </div>
          <p>
            The sample is clearly labeled, uses your current verified email, and
            does not pretend a month is due. At most one sample per day and
            three per month.
          </p>
          {data.messages.length > 0 && (
            <details>
              <summary>Reminder delivery history</summary>
              <ul>
                {data.messages.map((m) => (
                  <li key={m.id}>
                    {m.kind === "sample"
                      ? "Requested sample"
                      : m.kind === "closed"
                        ? "Closed-month reminder"
                        : "Follow-up reminder"}
                    : {m.status} · {new Date(m.createdAt).toLocaleDateString()}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p>Loading reminder settings…</p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
export function AdminOutcomeReminders() {
  const [data, setData] = useState<{
      enabled: boolean;
      paused: boolean;
      revision: number;
      delivery: Record<string, number>;
      usage: { day: number; month: number };
    } | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/outcome-reminders", {
          cache: "no-store",
        }),
        v = await r.json();
      if (!r.ok)
        throw new Error("Reporting reminder operations could not load.");
      setData(v);
    } catch {
      setMessage("Reporting reminder operations could not load.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function pause() {
    if (!data) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/outcome-reminders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision: data.revision,
            paused: !data.paused,
          }),
        }),
        v = await r.json();
      if (!r.ok) throw new Error();
      setData(v);
      setMessage(
        v.paused
          ? "Future reporting reminders are paused."
          : "Reporting reminder scheduling resumed.",
      );
    } catch {
      setMessage("Settings changed or are unavailable. Reload and try again.");
      await load();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-subsection">
      <h2>Outcome-reporting reminder operations</h2>
      <p>
        Fresh separate consent only. Ten jobs per scheduler batch;20/day
        and100/month. Two actual reminders per plan; sample mail has its own
        smaller owner allowance.
      </p>
      {data && (
        <>
          <p>
            Configuration: {data.enabled ? "enabled" : "disabled"} ·{" "}
            {data.paused ? "paused" : "running"} · Reserved {data.usage.day}/20
            today,{data.usage.month}/100 this month.
          </p>
          <ul>
            {Object.entries(data.delivery).map(([k, v]) => (
              <li key={k}>
                {k}: {v}
              </li>
            ))}
          </ul>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void pause()}
          >
            {data.paused
              ? "Resume reporting reminders"
              : "Pause reporting reminders"}
          </button>
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
