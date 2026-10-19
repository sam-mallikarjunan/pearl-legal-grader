"use client";
import { useCallback, useEffect, useId, useState } from "react";
import type { CloudReport } from "../lib/account/types";
import type { OutcomePlan } from "../lib/outcome-plans";
import {
  closedOutcomeDatePreset,
  OUTCOME_CSV_MAX_BYTES,
  outcomeCsvTemplate,
  parseOutcomeCsv,
  repeatOutcomeSetup,
  type OutcomeDatePreset,
} from "../lib/outcome-import";
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
import "./outcome-tracker.css";

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
  ...closedOutcomeDatePreset("last_month"),
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
const formFromPeriod = (period: OutcomePeriodInput): FormValues => {
  const next = blank();
  for (const key of Object.keys(next) as Array<keyof FormValues>) {
    const value = period[key];
    next[key] =
      value === null
        ? ""
        : OUTCOME_MONEY_FIELDS.includes(key as never)
          ? (Number(value) / 100).toFixed(2)
          : String(value);
  }
  return next;
};
const hasDetails = (period: OutcomePeriodInput) =>
  ["contacted", "booked", "attended", ...OUTCOME_MONEY_FIELDS].some(
    (key) => period[key as keyof OutcomePeriodInput] !== null,
  );
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
  for (const field of OUTCOME_COUNT_FIELDS) {
    const raw = form[field].trim();
    if (raw && !/^\d{1,7}$/.test(raw))
      throw new Error(
        "Enter non-negative whole counts, or leave unknown blank.",
      );
    value[field] = raw ? Number(raw) : null;
  }
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
  const hours = form.adminHours.trim();
  if (hours && !/^\d{1,5}(?:\.\d{1,2})?$/.test(hours))
    throw new Error(
      "Enter your own administrative hours with at most two decimal places, or leave unknown blank.",
    );
  value.adminHours = hours ? Number(hours) : null;
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
    [detailsOpen, setDetailsOpen] = useState(false),
    [importOpen, setImportOpen] = useState(false),
    [csvText, setCsvText] = useState(""),
    [csvPreview, setCsvPreview] = useState<OutcomePeriodInput | null>(null),
    [importMessage, setImportMessage] = useState(""),
    [plans, setPlans] = useState<OutcomePlan[]>([]),
    [selectedPlanId, setSelectedPlanId] = useState(""),
    [planMessage, setPlanMessage] = useState(""),
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
  const loadPlans = useCallback(async () => {
    try {
      const response = await fetch("/api/account/outcome-plans", {
        cache: "no-store",
      });
      const value = await response.json();
      if (!response.ok || !Array.isArray(value.plans))
        throw new Error(
          "Registered periods could not load. Reload before reporting against a registered baseline.",
        );
      setPlans(value.plans);
      setPlanMessage("");
    } catch {
      setPlanMessage(
        "Registered periods could not load. Reload before reporting against a registered baseline.",
      );
    }
  }, []);
  useEffect(() => {
    void loadPlans();
    const onPlansChange = () => void loadPlans();
    window.addEventListener("grader:outcome-plans-changed", onPlansChange);
    return () =>
      window.removeEventListener("grader:outcome-plans-changed", onPlansChange);
  }, [loadPlans]);
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId),
    editingPlan = editing
      ? plans.find((plan) => plan.outcomeId === editing.id)
      : undefined,
    frozenPlan = editingPlan || selectedPlan;
  const change = (field: keyof FormValues, value: string) =>
    setForm((previous) => ({ ...previous, [field]: value }));
  async function savePeriod(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (
        selectedPlanId &&
        (!selectedPlan || selectedPlan.status !== "registered")
      )
        throw new Error(
          "This registered period is no longer available. Reload registered periods before saving.",
        );
      const period = parseForm(form);
      const values = Object.fromEntries(
        [
          ...OUTCOME_COUNT_FIELDS,
          ...OUTCOME_MONEY_FIELDS,
          "adminHours" as const,
        ].map((field) => [field, period[field]]),
      );
      const response = await fetch(
        editing
          ? `/api/account/outcomes/${editing.id}`
          : selectedPlan
            ? `/api/account/outcome-plans/${selectedPlan.id}/report`
            : "/api/account/outcomes",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editing
              ? { revision: editing.revision, period }
              : selectedPlan
                ? { revision: selectedPlan.revision, values }
                : period,
          ),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "This period could not be saved.");
      setForm(blank());
      setEditing(null);
      setSelectedPlanId("");
      setDetailsOpen(false);
      await load();
      window.dispatchEvent(new Event("grader:outcome-plans-changed"));
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
    setForm(formFromPeriod(period));
    setEditing(period);
    setSelectedPlanId("");
    setDetailsOpen(hasDetails(period));
    clearImport();
    setDeleting(null);
    setMessage(
      "Editing your saved period. Saving creates a new revision; the issued grade stays unchanged.",
    );
  }
  function clearImport() {
    setCsvText("");
    setCsvPreview(null);
    setImportMessage("");
    setImportOpen(false);
  }
  function usePreset(preset: OutcomeDatePreset) {
    setForm((previous) => ({
      ...previous,
      ...closedOutcomeDatePreset(preset),
    }));
  }
  function choosePlan(planId: string) {
    const plan = plans.find((entry) => entry.id === planId);
    setSelectedPlanId(planId);
    setForm(
      plan
        ? {
            ...blank(),
            startDate: plan.startDate,
            endDate: plan.endDate,
            source: plan.source,
            currency: plan.currency,
            baselineReportId: plan.baselineReportId || "",
          }
        : blank(),
    );
    setDetailsOpen(false);
    clearImport();
    setMessage(
      plan
        ? "Dates, source, currency and baseline are fixed by your registration. Enter only this period’s known totals."
        : "New unregistered period. All totals are blank.",
    );
  }
  function repeatSetup(period: OutcomePeriod) {
    setForm(formFromPeriod(repeatOutcomeSetup(period)));
    setEditing(null);
    setSelectedPlanId("");
    setDeleting(null);
    setDetailsOpen(hasDetails(period));
    clearImport();
    setMessage(
      "Source, currency and optional sections reused. All numbers and the baseline link are blank. Choose a closed date range that does not overlap a saved period.",
    );
    document.getElementById(`${id}-start`)?.focus();
  }
  function previewImport() {
    setCsvPreview(null);
    try {
      setCsvPreview(parseOutcomeCsv(csvText));
      setImportMessage(
        "Preview ready. Review these totals before using them in the form.",
      );
    } catch (error) {
      setImportMessage(
        error instanceof Error
          ? error.message
          : "This aggregate row could not be read.",
      );
    } finally {
      // Keep only validated aggregates in memory, including after a rejected paste.
      setCsvText("");
    }
  }
  function downloadTemplate() {
    const url = URL.createObjectURL(
      new Blob([outcomeCsvTemplate()], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "pearl-business-period-template.csv";
    link.click();
    URL.revokeObjectURL(url);
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
      window.dispatchEvent(new Event("grader:outcome-plans-changed"));
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
          <form
            onSubmit={(event) => void savePeriod(event)}
            className="outcome-form"
          >
            <h4>
              {editing ? "Edit business period" : "Add a business period"} ·{" "}
              {data.periods.length}/24 saved
            </h4>
            <p>Start with any of the three totals below. The rest can wait.</p>
            {!editing && (
              <label className="field-label" htmlFor={`${id}-plan`}>
                Report a registered period (optional)
                <select
                  id={`${id}-plan`}
                  aria-label="Report a registered period (optional)"
                  value={selectedPlanId}
                  disabled={busy}
                  onChange={(event) => choosePlan(event.target.value)}
                >
                  <option value="">Add an unregistered closed period</option>
                  {plans
                    .filter((plan) => plan.status === "registered")
                    .map((plan) => (
                      <option
                        key={plan.id}
                        value={plan.id}
                        disabled={plan.endDate > yesterday}
                      >
                        {plan.startDate} to {plan.endDate}
                        {plan.endDate > yesterday
                          ? " · opens after period ends"
                          : " · ready to report"}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {planMessage && (
              <p role="status">
                {planMessage}{" "}
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => void loadPlans()}
                >
                  Reload registered periods
                </button>
              </p>
            )}
            {frozenPlan && (
              <p className="outcome-fixed-note">
                This period uses its registered dates, source, currency and
                earlier baseline. You can correct totals without changing that
                setup.
              </p>
            )}
            <div
              className="outcome-actions"
              aria-label="Closed period date presets"
            >
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || !!frozenPlan}
                onClick={() => usePreset("last_month")}
              >
                Last calendar month
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || !!frozenPlan}
                onClick={() => usePreset("last_30_days")}
              >
                Last 30 complete days
              </button>
            </div>
            <div className="outcome-grid">
              <label className="field-label" htmlFor={`${id}-start`}>
                Start date
                <input
                  id={`${id}-start`}
                  type="date"
                  required
                  value={form.startDate}
                  max={yesterday}
                  disabled={busy || !!frozenPlan}
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
                  disabled={busy || !!frozenPlan}
                  onChange={(e) => change("endDate", e.target.value)}
                />
              </label>
              <label className="field-label" htmlFor={`${id}-source`}>
                Source
                <select
                  id={`${id}-source`}
                  aria-label="Source"
                  value={form.source}
                  disabled={busy || !!frozenPlan}
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
                  disabled={busy || !!frozenPlan}
                  onChange={(e) => change("currency", e.target.value)}
                >
                  {OUTCOME_CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset disabled={busy} className="outcome-fieldset">
              <legend>
                <strong>Three useful starting points</strong>
              </legend>
              <p>
                Inquiries first received during these dates, and how many of
                those same inquiries became clients by the end date. Your own
                administration time covers the whole period.
              </p>
              <div className="outcome-grid outcome-core">
                {(["inquiries", "clients", "adminHours"] as const).map(
                  (field) => (
                    <label
                      className="field-label"
                      key={field}
                      htmlFor={`${id}-${field}`}
                    >
                      {labels[field]}
                      <input
                        id={`${id}-${field}`}
                        type="number"
                        inputMode={
                          field === "adminHours" ? "decimal" : "numeric"
                        }
                        min={0}
                        max={
                          field === "adminHours"
                            ? Number.isFinite(days)
                              ? days * 24
                              : 8784
                            : 1000000
                        }
                        step={field === "adminHours" ? "0.01" : 1}
                        placeholder="Unknown"
                        value={form[field]}
                        onChange={(e) => change(field, e.target.value)}
                      />
                    </label>
                  ),
                )}
              </div>
              <p className="outcome-note">
                Leave any total you do not know blank. Zero means you know there
                were none. Administrative hours are yours, not the team’s
                combined hours.
              </p>
            </fieldset>
            <details
              className="outcome-details"
              open={detailsOpen}
              onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
            >
              <summary>More funnel and invoice details (optional)</summary>
              <fieldset disabled={busy} className="outcome-fieldset">
                <legend>
                  <strong>
                    The same inquiry cohort, through the period end
                  </strong>
                </legend>
                <p>
                  Of the inquiries entered above, how many reached each stage by
                  the end date? Later stages cannot exceed earlier known counts.
                </p>
                <div className="outcome-grid">
                  {(["contacted", "booked", "attended"] as const).map(
                    (field) => (
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
                    ),
                  )}
                </div>
              </fieldset>
              <fieldset disabled={busy} className="outcome-fieldset">
                <legend>
                  <strong>Money with explicit cohorts ({form.currency})</strong>
                </legend>
                <p>
                  Enter ordinary currency amounts with up to two decimal places.
                  Acquisition spend belongs to the inquiry cohort above. Billed
                  money covers invoices issued during these dates; collected
                  money covers only payments on those same invoices received by
                  the period end. Do not substitute all cash received during the
                  period.
                </p>
                <div className="outcome-grid">
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
              <label className="field-label" htmlFor={`${id}-baseline`}>
                Earlier saved baseline (optional)
                <select
                  id={`${id}-baseline`}
                  aria-label="Earlier saved baseline (optional)"
                  value={form.baselineReportId}
                  disabled={busy || !!frozenPlan}
                  onChange={(e) => change("baselineReportId", e.target.value)}
                >
                  <option value="">Keep this period unlinked</option>
                  {reports.map((report) => (
                    <option
                      key={report.id}
                      value={report.id}
                      disabled={
                        !!form.startDate &&
                        (Date.parse(report.savedAt) >
                          Date.parse(`${form.startDate}T00:00:00.000Z`) ||
                          Date.parse(report.snapshot.createdAt) >
                            Date.parse(`${form.startDate}T00:00:00.000Z`))
                      }
                    >
                      {new Date(report.snapshot.createdAt).toLocaleDateString()}{" "}
                      · {report.snapshot.label}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                A linked report must have been assessed and saved before the
                period started. Leaving it unlinked still lets you track your
                own results. A baseline chosen afterward is a retrospective
                link.
              </p>
            </details>
            <div className="outcome-actions">
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
                    setDetailsOpen(false);
                  }}
                >
                  Cancel editing
                </button>
              )}
            </div>
          </form>
          {!editing && !selectedPlanId && (
            <details
              className="outcome-details outcome-import"
              open={importOpen}
              onToggle={(event) => {
                setImportOpen(event.currentTarget.open);
                if (!event.currentTarget.open) {
                  setCsvText("");
                  setCsvPreview(null);
                  setImportMessage("");
                }
              }}
            >
              <summary>
                Use one row of aggregate totals from a spreadsheet
              </summary>
              <p>
                Download the template, fill one totals row, then paste it here.
                No client, matter or contact rows. Currency amounts use ordinary
                units, for example 123.45. Empty cells stay unknown.
              </p>
              <p>
                Only the template’s named columns are accepted. This is a local
                preview, not a connection to or verification of your records.
                Raw CSV is cleared after preview and is never uploaded or
                stored.
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={downloadTemplate}
              >
                Download aggregate CSV template
              </button>
              <label className="field-label" htmlFor={`${id}-csv`}>
                Paste aggregate CSV (one header row and one totals row)
                <textarea
                  id={`${id}-csv`}
                  rows={5}
                  maxLength={OUTCOME_CSV_MAX_BYTES}
                  value={csvText}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  onChange={(event) => {
                    setCsvText(event.target.value);
                    setCsvPreview(null);
                    setImportMessage("");
                  }}
                />
              </label>
              <div className="outcome-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || !csvText.trim()}
                  onClick={previewImport}
                >
                  Preview totals locally
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={clearImport}
                >
                  Clear import
                </button>
              </div>
              <p role="status" aria-live="polite">
                {importMessage}
              </p>
              {csvPreview && (
                <section
                  aria-labelledby={`${id}-preview`}
                  className="outcome-import-preview"
                >
                  <h4 id={`${id}-preview`}>Review aggregate totals</h4>
                  <p>
                    {csvPreview.startDate} to {csvPreview.endDate} ·{" "}
                    {csvPreview.currency} ·{" "}
                    {csvPreview.source === "export"
                      ? "Copied from an export"
                      : "Typed from my records"}
                  </p>
                  <dl className="outcome-preview-grid">
                    {[
                      ...OUTCOME_COUNT_FIELDS,
                      ...OUTCOME_MONEY_FIELDS,
                      "adminHours" as const,
                    ].map((field) => (
                      <div key={field}>
                        <dt>{labels[field]}</dt>
                        <dd>
                          {OUTCOME_MONEY_FIELDS.includes(field as never)
                            ? amount(csvPreview[field], csvPreview.currency)
                            : csvPreview[field] === null
                              ? "Unknown"
                              : csvPreview[field]}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => {
                      setForm(formFromPeriod(csvPreview));
                      setDetailsOpen(hasDetails(csvPreview));
                      clearImport();
                      setMessage(
                        "Totals copied into the form. Review them, then choose Save business period. Nothing has been saved yet.",
                      );
                      document.getElementById(`${id}-start`)?.focus();
                    }}
                  >
                    Use these totals in the form
                  </button>
                </section>
              )}
            </details>
          )}

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
                        onClick={() => repeatSetup(period)}
                      >
                        Use setup for a new period
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
