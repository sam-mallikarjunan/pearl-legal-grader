"use client";
import { useCallback, useEffect, useId, useState } from "react";
import type { CloudReport } from "../lib/account/types";
import { OUTCOME_CURRENCIES } from "../lib/outcomes";
import { parseOutcomePlanInput, type OutcomePlan } from "../lib/outcome-plans";
import "./outcome-plans.css";
export type { OutcomePlan } from "../lib/outcome-plans";
function nextMonth() {
  const today = new Date();
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1),
  );
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  );
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}
export default function OutcomePlans({
  baselineReports,
  onChanged,
}: {
  baselineReports: CloudReport[];
  onChanged?: () => void;
}) {
  const id = useId();
  const [plans, setPlans] = useState<OutcomePlan[]>([]),
    [releaseId, setReleaseId] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [form, setForm] = useState(() => ({
    ...nextMonth(),
    baselineReportId: "",
    source: "self_reported",
    currency: "USD",
  }));
  const [requestId, setRequestId] = useState("");
  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        fetch("/api/account/outcome-plans", { cache: "no-store" }),
        fetch("/api/config/active", { cache: "no-store" }),
      ]);
      const result = await p.json(),
        config = await c.json();
      if (!p.ok || !c.ok)
        throw new Error(result.error || "Your outcome plans could not load.");
      setPlans(result.plans);
      setReleaseId(config.release.id);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Your outcome plans could not load.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
    const changed = () => void load();
    window.addEventListener("grader:outcome-plans-changed", changed);
    return () =>
      window.removeEventListener("grader:outcome-plans-changed", changed);
  }, [load]);
  const eligible = baselineReports.filter(
    (r) =>
      r.canonical &&
      !r.snapshot.isSample &&
      r.snapshot.assessment.releaseId === releaseId,
  );
  const change = (key: keyof typeof form, value: string) => {
    setForm((v) => ({ ...v, [key]: value }));
    setRequestId("");
  };
  const changed = () => {
    window.dispatchEvent(new Event("grader:outcome-plans-changed"));
    onChanged?.();
  };
  async function register(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const token = requestId || crypto.randomUUID();
      setRequestId(token);
      const input = parseOutcomePlanInput({
        ...form,
        requestId: token,
        expectedReleaseId: releaseId,
      });
      const response = await fetch("/api/account/outcome-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "This plan could not be registered.");
      setRequestId("");
      setMessage(
        "Future period registered. Its dates, source, currency and baseline are now locked. Report your numbers after the period closes.",
      );
      changed();
      await load();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "This plan could not be registered.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function withdraw(plan: OutcomePlan) {
    setBusy(true);
    try {
      const response = await fetch(`/api/account/outcome-plans/${plan.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: plan.revision }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "This plan could not be withdrawn.");
      setMessage(
        "Plan withdrawn. Its registration stays in your private history and cannot be reopened. Existing outcome numbers are kept.",
      );
      changed();
      await load();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "This plan could not be withdrawn.",
      );
      await load();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="outcome-plans"
      className="outcome-plans"
      aria-labelledby={`${id}-title`}
    >
      <p className="eyebrow">PLAN ONE USEFUL MONTH</p>
      <h2 id={`${id}-title`}>Choose a baseline before the month begins</h2>
      <p>
        Register a future 28–31-day period now, then add your business numbers
        after it closes. This locks the comparison before you know the results.
        Tracking is private; separate research permissions decide whether it can
        contribute to aggregate evidence.
      </p>
      <p className="fine-print">
        All dates use UTC calendar days. Choose a baseline assessed within 90
        days before the period starts. An incomplete assessment or a later
        rubric change can make a plan ineligible for score research.
        Registration does not validate a prediction or certify a firm.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <form onSubmit={register}>
        <div className="outcome-plan-grid">
          <label htmlFor={`${id}-baseline`}>
            Plan baseline report
            <select
              id={`${id}-baseline`}
              aria-label="Plan baseline report"
              value={form.baselineReportId}
              required
              disabled={busy || !releaseId}
              onChange={(e) => change("baselineReportId", e.target.value)}
            >
              <option value="">Choose a current saved report</option>
              {eligible.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.snapshot.label} ·{" "}
                  {new Date(r.savedAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${id}-start`}>
            Plan start date
            <input
              id={`${id}-start`}
              type="date"
              required
              value={form.startDate}
              disabled={busy}
              onChange={(e) => change("startDate", e.target.value)}
            />
          </label>
          <label htmlFor={`${id}-end`}>
            Plan end date
            <input
              id={`${id}-end`}
              type="date"
              required
              value={form.endDate}
              disabled={busy}
              onChange={(e) => change("endDate", e.target.value)}
            />
          </label>
          <label htmlFor={`${id}-source`}>
            Plan figures source
            <select
              id={`${id}-source`}
              aria-label="Plan figures source"
              value={form.source}
              disabled={busy}
              onChange={(e) => change("source", e.target.value)}
            >
              <option value="self_reported">Owner-entered figures</option>
              <option value="export">Export-informed owner report</option>
            </select>
          </label>
          <label htmlFor={`${id}-currency`}>
            Plan currency
            <select
              id={`${id}-currency`}
              aria-label="Plan currency"
              value={form.currency}
              disabled={busy}
              onChange={(e) => change("currency", e.target.value)}
            >
              {OUTCOME_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="fine-print">
          Export-informed figures are still your report; no records have been
          independently verified. Once registered, these choices cannot change.
          Withdraw a mistaken plan and register a replacement before its start.
        </p>
        {eligible.length === 0 && (
          <p>
            Save a real assessment using the current rubric to register a future
            period.
          </p>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || eligible.length === 0 || !releaseId}
        >
          {busy ? "Saving…" : "Register future period"}
        </button>
      </form>
      <div className="outcome-plan-list">
        {plans.length === 0 ? (
          <p>No future periods registered yet.</p>
        ) : (
          plans.map((plan) => (
            <article key={plan.id}>
              <h3>
                {plan.startDate} to {plan.endDate}
              </h3>
              <p>
                <strong>
                  {plan.status === "registered"
                    ? plan.endDate < new Date().toISOString().slice(0, 10)
                      ? "Ready to report"
                      : "Registered"
                    : plan.status === "reported"
                      ? "Reported"
                      : "Withdrawn"}
                </strong>{" "}
                · {plan.currency} ·{" "}
                {plan.source === "export"
                  ? "Export-informed owner report"
                  : "Owner-entered figures"}
              </p>
              <p className="fine-print">
                Registered {new Date(plan.createdAt).toLocaleString()} ·
                Baseline rubric {plan.baselineReleaseId}.{" "}
                {plan.status === "withdrawn"
                  ? "This plan is closed permanently."
                  : "Dates, source, currency and baseline are locked. Use the business-period form to report or correct numbers."}
              </p>
              {plan.status !== "withdrawn" && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => void withdraw(plan)}
                  aria-label={`Withdraw plan ${plan.startDate} to ${plan.endDate}`}
                >
                  Withdraw plan
                </button>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
