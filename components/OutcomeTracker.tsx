"use client";
import { useCallback, useEffect, useId, useState } from "react";
import type { CloudReport } from "../lib/account/types";
import {
  calculateOutcomeMetrics,
  OUTCOME_COUNT_FIELDS,
  OUTCOME_CURRENCIES,
  OUTCOME_MONEY_FIELDS,
  OUTCOME_RESEARCH_TEXT,
  OUTCOME_RESEARCH_VERSION,
  outcomePeriodDays,
  parseOutcomePeriodInput,
  type OutcomeAccountState,
  type OutcomePeriod,
  type OutcomePeriodInput,
} from "../lib/outcomes";

const labels = {
  inquiries: "New inquiries in this cohort",
  contacted: "Inquiries meaningfully contacted",
  booked: "Consultations booked",
  attended: "Consultations attended",
  clients: "Engagements accepted",
  leadSpendMinor: "Acquisition spend for this cohort",
  cohortBilledMinor: "Invoices issued during this period",
  cohortCollectedMinor: "Collected on those invoices by period end",
  adminHours: "Your own administrative hours",
};
type FormValues = Record<
  | (typeof OUTCOME_COUNT_FIELDS)[number]
  | (typeof OUTCOME_MONEY_FIELDS)[number]
  | "adminHours"
  | "startDate"
  | "endDate"
  | "baselineReportId"
  | "source"
  | "currency",
  string
>;
const blank = (): FormValues => ({
  startDate: "",
  endDate: "",
  baselineReportId: "",
  source: "self_reported",
  currency: "USD",
  inquiries: "",
  contacted: "",
  booked: "",
  attended: "",
  clients: "",
  leadSpendMinor: "",
  cohortBilledMinor: "",
  cohortCollectedMinor: "",
  adminHours: "",
});
const rate = (n: number | null) =>
  n === null ? "Unknown" : `${(n * 100).toFixed(1)}%`;
const amount = (n: number | null, currency: string) =>
  n === null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
        n / 100,
      );
function parseForm(form: FormValues): OutcomePeriodInput {
  const value: Record<string, unknown> = {
    startDate: form.startDate,
    endDate: form.endDate,
    baselineReportId: form.baselineReportId || null,
    source: form.source,
    currency: form.currency,
  };
  for (const field of OUTCOME_COUNT_FIELDS)
    value[field] = form[field].trim() ? Number(form[field]) : null;
  for (const field of OUTCOME_MONEY_FIELDS) {
    const raw = form[field].trim();
    if (!raw) {
      value[field] = null;
      continue;
    }
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(raw))
      throw new Error(
        "Enter money with at most two decimal places, or leave unknown blank.",
      );
    const [whole, fraction = ""] = raw.split(".");
    value[field] = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  }
  value.adminHours = form.adminHours.trim() ? Number(form.adminHours) : null;
  return parseOutcomePeriodInput(value);
}
export default function OutcomeTracker({
  baselineReports,
}: {
  baselineReports?: CloudReport[];
}) {
  const id = useId();
  const [data, setData] = useState<OutcomeAccountState | null>(null),
    [reports, setReports] = useState<CloudReport[]>(baselineReports || []),
    [form, setForm] = useState<FormValues>(blank),
    [editing, setEditing] = useState<OutcomePeriod | null>(null),
    [deleting, setDeleting] = useState<string | null>(null),
    [research, setResearch] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account/outcomes", {
        cache: "no-store",
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error || "Your business periods could not load.");
      setData(value);
      setResearch(value.consent.granted);
      if (baselineReports) setReports(baselineReports);
      else {
        const reportResponse = await fetch("/api/account/reports", {
          cache: "no-store",
        });
        if (reportResponse.ok) {
          const result = await reportResponse.json();
          if (Array.isArray(result.reports)) setReports(result.reports);
        }
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Your business periods could not load.",
      );
    }
  }, [baselineReports]);
  useEffect(() => {
    void load();
  }, [load]);
  const change = (field: keyof FormValues, value: string) =>
    setForm((previous) => ({ ...previous, [field]: value }));
  async function savePeriod(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const period = parseForm(form);
      const response = await fetch(
        editing
          ? `/api/account/outcomes/${editing.id}`
          : "/api/account/outcomes",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editing ? { revision: editing.revision, period } : period,
          ),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "This period could not be saved.");
      setForm(blank());
      setEditing(null);
      await load();
      setMessage(
        "Business period saved privately. Your issued grade is unchanged.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "This period could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  function edit(period: OutcomePeriod) {
    const next = blank();
    for (const key of Object.keys(next) as Array<keyof FormValues>) {
      const v = period[key];
      next[key] =
        v === null
          ? ""
          : OUTCOME_MONEY_FIELDS.includes(key as never)
            ? (Number(v) / 100).toFixed(2)
            : String(v);
    }
    setForm(next);
    setEditing(period);
    setDeleting(null);
    setMessage(
      "Editing your saved period. Saving creates a new revision; the issued grade stays unchanged.",
    );
  }
  async function remove(period: OutcomePeriod) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/account/outcomes/${period.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: period.revision }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "This period could not be deleted.");
      setDeleting(null);
      if (editing?.id === period.id) {
        setEditing(null);
        setForm(blank());
      }
      await load();
      setMessage(
        "Business period deleted. Minimal change history remains in your private account export.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "This period could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveConsent() {
    if (!data) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/outcomes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          granted: research,
          revision: data.consent.revision,
          consentVersion: OUTCOME_RESEARCH_VERSION,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "The research permission could not be saved.",
        );
      setData((old) => (old ? { ...old, consent: result.consent } : old));
      setResearch(result.consent.granted);
      setMessage(
        result.consent.granted
          ? "Outcome research permission saved. Linked calibration also requires your separate assessment-benchmarking permission."
          : "Outcome research permission withdrawn. Your periods stay private for your own tracking.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The research permission could not be saved.",
      );
      await load();
    } finally {
      setBusy(false);
    }
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    days = outcomePeriodDays(form.startDate, form.endDate);
  return (
    <section
      id="business-outcomes"
      className="account-subsection"
      aria-labelledby={`${id}-title`}
    >
      <p className="eyebrow">PRIVATE · YOUR BUSINESS RESULTS</p>
      <h3 id={`${id}-title`}>Measure what changed</h3>
      <p>
        Save a closed 7–366 day period and compare your own results over time.
        Funnel counts and acquisition spend use the same group of new inquiries.
        Billing and collections use the separate invoice cohort defined below.
        These observations never change an issued grade or prove that an action
        caused an improvement.
      </p>
      <p>
        Dates use UTC calendar days. Leave unknown values blank. Do not add
        client names, matter details or documents. “Copied from an export”
        describes your source; Pearl has not independently verified it.
      </p>
      {data ? (
        <>
          <form onSubmit={(event) => void savePeriod(event)}>
            <h4>
              {editing ? "Edit business period" : "Add a business period"} ·{" "}
              {data.periods.length}/24 saved
            </h4>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
                gap: 16,
              }}
            >
              <label className="field-label" htmlFor={`${id}-start`}>
                Start date
                <input
                  id={`${id}-start`}
                  type="date"
                  required
                  value={form.startDate}
                  max={yesterday}
                  disabled={busy}
                  onChange={(e) => change("startDate", e.target.value)}
                />
              </label>
              <label className="field-label" htmlFor={`${id}-end`}>
                End date
                <input
                  id={`${id}-end`}
                  type="date"
                  required
                  value={form.endDate}
                  max={yesterday}
                  disabled={busy}
                  onChange={(e) => change("endDate", e.target.value)}
                />
              </label>
              <label className="field-label" htmlFor={`${id}-source`}>
                Source
                <select
                  id={`${id}-source`}
                  aria-label="Source"
                  value={form.source}
                  disabled={busy}
                  onChange={(e) => change("source", e.target.value)}
                >
                  <option value="self_reported">Typed from my records</option>
                  <option value="export">Copied from an export</option>
                </select>
              </label>
              <label className="field-label" htmlFor={`${id}-currency`}>
                Currency for this whole period
                <select
                  id={`${id}-currency`}
                  aria-label="Currency for this whole period"
                  value={form.currency}
                  disabled={busy}
                  onChange={(e) => change("currency", e.target.value)}
                >
                  {OUTCOME_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label
              className="field-label"
              htmlFor={`${id}-baseline`}
              style={{ display: "block", marginTop: 16 }}
            >
              Earlier saved baseline (optional)
              <select
                id={`${id}-baseline`}
                aria-label="Earlier saved baseline (optional)"
                value={form.baselineReportId}
                disabled={busy}
                onChange={(e) => change("baselineReportId", e.target.value)}
              >
                <option value="">Keep this period unlinked</option>
                {reports.map((r) => (
                  <option
                    key={r.id}
                    value={r.id}
                    disabled={
                      !!form.startDate &&
                      (Date.parse(r.savedAt) >
                        Date.parse(`${form.startDate}T00:00:00.000Z`) ||
                        Date.parse(r.snapshot.createdAt) >
                          Date.parse(`${form.startDate}T00:00:00.000Z`))
                    }
                  >
                    {new Date(r.snapshot.createdAt).toLocaleDateString()} ·{" "}
                    {r.snapshot.label}
                  </option>
                ))}
              </select>
            </label>
            <p>
              A linked report must have been assessed and saved before the
              period started. Leaving it unlinked still lets you track your own
              results.
            </p>
            <fieldset
              disabled={busy}
              style={{ border: 0, padding: 0, margin: "24px 0" }}
            >
              <legend>
                <strong>The same inquiry cohort, through the period end</strong>
              </legend>
              <p>
                Count inquiries that entered during these dates, then how many
                of those same inquiries reached each stage by the end date.
                Later stages cannot exceed earlier known counts.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
                  gap: 16,
                }}
              >
                {OUTCOME_COUNT_FIELDS.map((field) => (
                  <label
                    className="field-label"
                    key={field}
                    htmlFor={`${id}-${field}`}
                  >
                    {labels[field]}
                    <input
                      id={`${id}-${field}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={1000000}
                      step={1}
                      placeholder="Unknown"
                      value={form[field]}
                      onChange={(e) => change(field, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset
              disabled={busy}
              style={{ border: 0, padding: 0, margin: "24px 0" }}
            >
              <legend>
                <strong>Money with explicit cohorts ({form.currency})</strong>
              </legend>
              <p>
                Enter ordinary currency amounts, with up to two decimal places.
                Acquisition spend belongs to the inquiry cohort above. Billed
                money covers invoices issued during these dates; collected money
                covers only payments on those same invoices received by the
                period end. Do not substitute all cash received during the
                period.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
                  gap: 16,
                }}
              >
                {OUTCOME_MONEY_FIELDS.map((field) => (
                  <label
                    className="field-label"
                    key={field}
                    htmlFor={`${id}-${field}`}
                  >
                    {labels[field]}
                    <input
                      id={`${id}-${field}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100000000}
                      step="0.01"
                      placeholder="Unknown"
                      value={form[field]}
                      onChange={(e) => change(field, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field-label" htmlFor={`${id}-hours`}>
              {labels.adminHours}
              <input
                id={`${id}-hours`}
                type="number"
                inputMode="decimal"
                min={0}
                max={Number.isFinite(days) ? days * 24 : 8784}
                step="0.01"
                placeholder="Unknown"
                value={form.adminHours}
                disabled={busy}
                onChange={(e) => change("adminHours", e.target.value)}
              />
            </label>
            <p>
              Your own time on business administration during the whole date
              range, rather than your team’s combined hours. This is a
              period-level time measure, separate from the inquiry cohort.
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                marginTop: 20,
              }}
            >
              <button
                className="btn btn-primary"
                type="submit"
                disabled={busy || (!editing && data.periods.length >= 24)}
              >
                {busy
                  ? "Saving…"
                  : editing
                    ? "Save period changes"
                    : "Save business period"}
              </button>
              {editing && (
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(null);
                    setForm(blank());
                  }}
                >
                  Cancel editing
                </button>
              )}
            </div>
          </form>
          <section aria-labelledby={`${id}-history`} style={{ marginTop: 32 }}>
            <h4 id={`${id}-history`}>Your saved periods</h4>
            {data.periods.length === 0 ? (
              <p>
                No business periods saved yet. Empty fields will stay unknown.
              </p>
            ) : (
              data.periods.map((period) => {
                const metrics = calculateOutcomeMetrics(period);
                return (
                  <article
                    key={period.id}
                    style={{
                      borderTop: "1px solid var(--border, #d9e3df)",
                      padding: "20px 0",
                    }}
                  >
                    <h4>
                      {period.startDate} to {period.endDate}
                    </h4>
                    <p>
                      {metrics.periodDays} days · {period.currency} ·{" "}
                      {period.source === "export"
                        ? "Owner copied from an export"
                        : "Owner-reported"}{" "}
                      ·{" "}
                      {period.baselineReportId
                        ? "Linked to an earlier saved report"
                        : "Unlinked"}
                    </p>
                    <dl>
                      <div>
                        <dt>Inquiries becoming clients</dt>
                        <dd>{rate(metrics.inquiryToClientRate)}</dd>
                      </div>
                      <div>
                        <dt>Acquisition spend per accepted engagement</dt>
                        <dd>
                          {amount(metrics.costPerClientMinor, period.currency)}
                        </dd>
                      </div>
                      <div>
                        <dt>Period-issued invoices collected by period end</dt>
                        <dd>{rate(metrics.collectionRate)}</dd>
                      </div>
                      <div>
                        <dt>Your administration hours per calendar day</dt>
                        <dd>
                          {metrics.adminHoursPerDay === null
                            ? "Unknown"
                            : metrics.adminHoursPerDay.toFixed(2)}
                        </dd>
                      </div>
                    </dl>
                    <details>
                      <summary>See your recorded aggregates</summary>
                      <dl>
                        {[
                          ...OUTCOME_COUNT_FIELDS,
                          ...OUTCOME_MONEY_FIELDS,
                          "adminHours" as const,
                        ].map((field) => (
                          <div key={field}>
                            <dt>{labels[field]}</dt>
                            <dd>
                              {OUTCOME_MONEY_FIELDS.includes(field as never)
                                ? amount(period[field], period.currency)
                                : period[field] === null
                                  ? "Unknown"
                                  : period[field]}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <p>
                        Saved revision {period.revision}. Source and values are
                        owner assertions, not independently verified outcomes.
                      </p>
                    </details>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 12,
                        marginTop: 16,
                      }}
                    >
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() => edit(period)}
                      >
                        Edit period
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() => setDeleting(period.id)}
                      >
                        Delete period
                      </button>
                    </div>
                    {deleting === period.id && (
                      <div role="group" aria-label="Confirm period deletion">
                        <p>
                          Delete this saved period? It will no longer be
                          available for your tracking or future calibration.
                          Minimal private change history remains.
                        </p>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={busy}
                          onClick={() => void remove(period)}
                        >
                          Confirm deletion
                        </button>{" "}
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={busy}
                          onClick={() => setDeleting(null)}
                        >
                          Keep period
                        </button>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </section>
          <section
            aria-labelledby={`${id}-research`}
            style={{
              borderTop: "1px solid var(--border, #d9e3df)",
              paddingTop: 24,
              marginTop: 24,
            }}
          >
            <h4 id={`${id}-research`}>Optional outcome research</h4>
            <label
              htmlFor={`${id}-research-checkbox`}
              style={{ display: "flex", alignItems: "flex-start", gap: 12 }}
            >
              <input
                id={`${id}-research-checkbox`}
                type="checkbox"
                checked={research}
                disabled={busy}
                onChange={(e) => setResearch(e.target.checked)}
                style={{ flex: "0 0 auto", marginTop: 5 }}
              />
              <span>{OUTCOME_RESEARCH_TEXT}</span>
            </label>
            <p>
              Using linked outcomes to evaluate a grade also requires your
              separate assessment-benchmarking permission. This option does not
              publish your periods or enroll you in email or a leaderboard.
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || research === data.consent.granted}
              onClick={() => void saveConsent()}
            >
              Save outcome research permission
            </button>
          </section>
        </>
      ) : (
        <>
          <p>Your private periods are loading.</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void load()}
          >
            Reload periods
          </button>
        </>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
