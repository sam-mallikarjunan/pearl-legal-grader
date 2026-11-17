"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ACTION_CONFOUNDER_LABELS,
  ACTION_OBSERVATION_LIMIT,
} from "../lib/action-observations";
import {
  MONTHLY_BRIEF_DECISIONS,
  MONTHLY_BRIEF_VERSION,
  type MonthlyPracticeBrief as Brief,
  type MonthlyPracticeBriefResponse,
} from "../lib/monthly-practice-brief";
import { OUTCOME_CURRENCIES, OUTCOME_SOURCES } from "../lib/outcomes";
import {
  PROGRESS_METRIC_IDS,
  progressMetricDefinition,
  type ProgressMetricId,
  type ProgressObservation,
} from "../lib/progress-insights";
import "./monthly-practice-brief.css";

const endpoint = "/api/account/monthly-practice-brief";
const changes = [
  "grader:outcomes-changed",
  "grader:outcome-plans-changed",
  "grader:action-observations-changed",
] as const;
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const month = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
type Choice = (typeof MONTHLY_BRIEF_DECISIONS)[number];
type Decision = NonNullable<Brief["decision"]>;

const decisionCopy: Record<Choice, { label: string; meaning: string }> = {
  keep: { label: "Keep", meaning: "Continue the current approach." },
  adjust: { label: "Adjust", meaning: "Try it differently next time." },
  stop: { label: "Stop", meaning: "Set this approach aside." },
  need_more_data: {
    label: "Need more data",
    meaning: "Wait for more usable figures before deciding.",
  },
};
const metricLabel: Record<ProgressMetricId, string> = {
  inquiry_conversion: "Inquiry-to-client rate",
  invoice_collection: "Collection rate on invoices issued in each period",
  cost_per_client: "Acquisition spend per retained client",
  owner_admin_hours_day: "Owner admin hours per calendar day",
};
const statusCopy: Record<Brief["status"], { label: string; message: string }> =
  {
    descriptive: {
      label: "Ready to review",
      message:
        "The exact month you registered is closed and has a usable result.",
    },
    waiting: {
      label: "Upcoming",
      message:
        "Come back after the registered month closes to review its result.",
    },
    unreported: {
      label: "Figures needed",
      message:
        "This month has closed. Add figures to the original plan to compare it with your baseline.",
    },
    unknown: {
      label: "Unable to compare",
      message:
        "The exact follow-up is missing, incompatible, or does not have a known value for this measure.",
    },
    baseline_changed: {
      label: "Baseline changed",
      message:
        "The saved baseline changed or was removed. Its frozen figures are historical; this comparison is withheld.",
    },
    plan_unavailable: {
      label: "Plan unavailable",
      message:
        "The original plan or report is no longer available for comparison.",
    },
    withdrawn: {
      label: "Withdrawn",
      message:
        "You withdrew this action observation. No new decision can be saved for it.",
    },
  };
const implementation: Record<Brief["implementation"], string> = {
  unreported: "Not reported",
  not_started: "Not started",
  started_as_planned: "Started as planned",
  started_late: "Started late",
  not_implemented: "Not implemented",
  unsure: "Unsure",
};

function monthLabel(startDate: string) {
  const date = new Date(`${startDate}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? month.format(date) : startDate;
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    value / 100,
  );
}

function valueLabel(
  value: number,
  metricId: ProgressMetricId,
  currency: string,
) {
  if (metricId === "cost_per_client")
    return `${formatMoney(value, currency)} per client`;
  if (metricId === "owner_admin_hours_day")
    return `${number.format(value)} hr / day`;
  return `${number.format(value)}%`;
}

function measurementInputs(observation: ProgressObservation, brief: Brief) {
  const { numerator, denominator } = observation;
  const count = (value: number | null) =>
    value === null ? "Unknown" : number.format(value);
  const amount = (value: number | null) =>
    value === null ? "Unknown" : formatMoney(value, brief.window.currency);
  switch (brief.metricId) {
    case "inquiry_conversion":
      return `${count(numerator)} retained clients / ${count(denominator)} new inquiries`;
    case "invoice_collection":
      return `${amount(numerator)} collected / ${amount(denominator)} issued`;
    case "cost_per_client":
      return `${amount(numerator)} acquisition spend / ${count(denominator)} retained clients`;
    case "owner_admin_hours_day":
      return `${count(numerator)} admin hours / ${count(denominator)} calendar days`;
  }
}

function deltaLabel(brief: Brief) {
  if (brief.status !== "descriptive" || brief.delta === null) return null;
  if (brief.delta === 0) return "No change between the two periods";
  const change = Math.abs(brief.delta);
  const direction = brief.delta > 0 ? "Up" : "Down";
  if (brief.metricId === "cost_per_client")
    return `${direction} ${change < 1 ? `less than ${formatMoney(1, brief.window.currency)}` : formatMoney(change, brief.window.currency)} per retained client`;
  const magnitude = change < 0.01 ? "less than 0.01" : number.format(change);
  const unit =
    brief.metricId === "owner_admin_hours_day"
      ? "hours per calendar day"
      : change === 1
        ? "percentage point"
        : "percentage points";
  return `${direction} ${magnitude} ${unit}`;
}

function PeriodCard({
  label,
  window,
  measurement,
  brief,
}: {
  label: string;
  window: { startDate: string; endDate: string };
  measurement: ProgressObservation | null;
  brief: Brief;
}) {
  return (
    <div className="practice-brief-period">
      <dt>{label}</dt>
      <dd>
        <span className="practice-brief-dates">
          {window.startDate} to {window.endDate}
        </span>
        {measurement ? (
          <>
            <strong>
              {measurement.value === null
                ? "Unknown"
                : valueLabel(
                    measurement.value,
                    brief.metricId,
                    brief.window.currency,
                  )}
            </strong>
            <span>{measurementInputs(measurement, brief)}</span>
            {measurement.reason && (
              <span className="fine-print">{measurement.reason}</span>
            )}
          </>
        ) : (
          <span>No comparable figure available</span>
        )}
      </dd>
    </div>
  );
}

function isDecision(value: unknown): value is Decision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const d = value as Decision;
  return (
    MONTHLY_BRIEF_DECISIONS.includes(d.choice) &&
    Number.isSafeInteger(d.revision) &&
    d.revision >= 0 &&
    typeof d.savedAt === "string" &&
    Number.isFinite(Date.parse(d.savedAt)) &&
    typeof d.current === "boolean"
  );
}

function isPeriod(value: { startDate: string; endDate: string } | null) {
  return (
    !!value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.endDate) &&
    value.startDate <= value.endDate
  );
}

function isMeasurement(value: ProgressObservation | null) {
  return (
    !!value &&
    [value.value, value.numerator, value.denominator].every(
      (field) => field === null || (Number.isFinite(field) && field >= 0),
    ) &&
    (value.value === null ||
      (value.numerator !== null &&
        value.denominator !== null &&
        value.denominator > 0)) &&
    (value.reason === null || typeof value.reason === "string")
  );
}

function readBriefs(value: unknown): Brief[] {
  if (!value || typeof value !== "object") throw new Error("Invalid brief");
  const data = value as MonthlyPracticeBriefResponse;
  if (
    data.version !== MONTHLY_BRIEF_VERSION ||
    !Array.isArray(data.briefs) ||
    data.briefs.length > ACTION_OBSERVATION_LIMIT ||
    data.briefs.some(
      (brief) =>
        !brief ||
        typeof brief.observationId !== "string" ||
        !brief.action ||
        typeof brief.action.title !== "string" ||
        !Object.hasOwn(statusCopy, brief.status) ||
        !Object.hasOwn(implementation, brief.implementation) ||
        !PROGRESS_METRIC_IDS.includes(brief.metricId) ||
        !isPeriod(brief.window) ||
        !isPeriod(brief.baselineWindow) ||
        !isMeasurement(brief.baseline) ||
        !OUTCOME_CURRENCIES.includes(brief.window.currency) ||
        !OUTCOME_SOURCES.includes(brief.window.source) ||
        (brief.followup !== null && !isMeasurement(brief.followup)) ||
        (brief.status === "descriptive"
          ? !Number.isFinite(brief.delta) || brief.followup?.value == null
          : brief.delta !== null) ||
        !Array.isArray(brief.confounders) ||
        !Array.isArray(brief.availableDecisions) ||
        brief.availableDecisions.some(
          (choice: Choice) => !MONTHLY_BRIEF_DECISIONS.includes(choice),
        ) ||
        (brief.decision !== null && !isDecision(brief.decision)),
    )
  )
    throw new Error("Invalid brief");
  return data.briefs;
}

function DecisionForm({
  brief,
  onSaved,
  onStale,
}: {
  brief: Brief;
  onSaved: (id: string, decision: Decision) => void;
  onStale: (message: string) => void;
}) {
  const group = useId();
  const writing = useRef<AbortController | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => writing.current?.abort(), []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !choice ||
      !brief.evidence ||
      !brief.availableDecisions.includes(choice) ||
      writing.current
    )
      return;
    const controller = new AbortController();
    writing.current = controller;
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observationId: brief.observationId,
          choice,
          expectedDecisionRevision: brief.decision?.revision ?? null,
          evidence: brief.evidence,
        }),
      });
      if (controller.signal.aborted) return;
      if (response.status === 409) {
        onStale(
          "This brief changed. Review the latest figures and choose again.",
        );
        return;
      }
      if (!response.ok) throw new Error("Save not confirmed");
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (
        !isDecision(body?.decision) ||
        body.decision.choice !== choice ||
        !body.decision.current
      )
        throw new Error("Save not confirmed");
      onSaved(brief.observationId, body.decision);
      setChoice(null);
    } catch {
      if (!controller.signal.aborted)
        onStale(
          "We couldn’t confirm the save. Check the refreshed brief before trying again.",
        );
    } finally {
      if (writing.current === controller) writing.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy} className="practice-brief-choices">
        <legend>What will you do next?</legend>
        <div className="practice-brief-options">
          {brief.availableDecisions.map((item) => (
            <label className="practice-brief-option" key={item}>
              <input
                type="radio"
                name={group}
                value={item}
                checked={choice === item}
                onChange={() => setChoice(item)}
              />
              <span>
                <strong>{decisionCopy[item].label}</strong>
                <span>{decisionCopy[item].meaning}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="fine-print">
          This saves your decision privately. Your plan, score, and sharing
          choices stay as they were.
        </p>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={
            busy || !choice || !brief.availableDecisions.includes(choice)
          }
        >
          {busy ? "Saving…" : "Save private decision"}
        </button>
      </fieldset>
    </form>
  );
}

function BriefDetail({
  brief,
  onSaved,
  onStale,
}: {
  brief: Brief;
  onSaved: (id: string, decision: Decision) => void;
  onStale: (message: string) => void;
}) {
  const delta = deltaLabel(brief);
  const latest = statusCopy[brief.status];
  const isHistorical = [
    "baseline_changed",
    "plan_unavailable",
    "withdrawn",
  ].includes(brief.status);
  const factors = brief.confounders
    .map((factor) => ACTION_CONFOUNDER_LABELS[factor])
    .filter(Boolean)
    .join("; ");
  const isIntake =
    brief.metricId === "inquiry_conversion" ||
    brief.metricId === "cost_per_client";
  return (
    <div className="practice-brief-detail">
      <div className="practice-brief-summary">
        <div>
          <p className="eyebrow">{latest.label}</p>
          <h4>{brief.action.title}</h4>
        </div>
        <p>{latest.message}</p>
        <p className="practice-brief-metric">{metricLabel[brief.metricId]}</p>
        <p className="fine-print">
          {brief.window.source === "export"
            ? "Exported practice totals"
            : "Owner-reported totals"}{" "}
          · {brief.window.currency} · dates in UTC
        </p>
      </div>
      <dl className="practice-brief-periods" aria-label="Figures by period">
        <PeriodCard
          label={isHistorical ? "Frozen baseline (historical)" : "Baseline"}
          window={brief.baselineWindow}
          measurement={brief.baseline}
          brief={brief}
        />
        <PeriodCard
          label="Registered follow-up"
          window={brief.window}
          measurement={isHistorical ? null : brief.followup}
          brief={brief}
        />
      </dl>
      {delta && <p className="practice-brief-delta">{delta}</p>}
      <div className="practice-brief-caveat">
        <p>
          <strong>What else could explain it?</strong> Two periods can show what
          changed, but they cannot establish that this action caused it.
        </p>
        <p className="fine-print">
          Implementation (owner-reported):{" "}
          {implementation[brief.implementation]}.{" "}
          {factors && `Other factors: ${factors}.`}
        </p>
        {brief.concurrentRegistrations > 0 && (
          <p className="fine-print">
            Other tracked actions share this follow-up month.
          </p>
        )}
      </div>
      <details className="practice-brief-definition">
        <summary>How this measure is counted</summary>
        <p>{progressMetricDefinition(brief.metricId)}</p>
      </details>
      {brief.decision && (
        <p className="practice-brief-history">
          <strong>
            {brief.decision.current
              ? "Saved decision"
              : "Previous decision (historical)"}
            : {decisionCopy[brief.decision.choice].label}.
          </strong>{" "}
          {brief.decision.current
            ? `Saved ${brief.decision.savedAt.slice(0, 10)} UTC.`
            : "The evidence changed. This choice was saved against an earlier version."}
        </p>
      )}
      {brief.evidence && brief.availableDecisions.length > 0 && (
        <DecisionForm
          key={JSON.stringify([brief.observationId, brief.evidence])}
          brief={brief}
          onSaved={onSaved}
          onStale={onStale}
        />
      )}
      <div className="practice-brief-links">
        <a href="#first-improvement">Set up another improvement</a>
        {brief.status === "unreported" || brief.status === "unknown" ? (
          <a href="#business-outcomes">Review or add follow-up figures</a>
        ) : null}
        <a href="#action-outcome-tracking">
          Review implementation and other factors
        </a>
        {isIntake && (
          <a href="#missed-call-playbook">
            Open the missed-call follow-up playbook
          </a>
        )}
      </div>
    </div>
  );
}

export default function MonthlyPracticeBrief() {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hasPilotFeedback, setHasPilotFeedback] = useState(false);

  useEffect(() => {
    const reveal = () => {
      if (window.location.hash === "#monthly-practice-brief") setOpen(true);
    };
    const openForAction = (event: Event) => {
      const id = (event as CustomEvent<{ observationId?: string }>).detail
        ?.observationId;
      if (typeof id !== "string" || !id || id.length > 36) return;
      setSelectedId(id);
      setNotice("");
      setBriefs(null);
      setReload((n) => n + 1);
      setOpen(true);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    window.addEventListener("grader:monthly-brief-open", openForAction);
    return () => {
      window.removeEventListener("hashchange", reveal);
      window.removeEventListener("grader:monthly-brief-open", openForAction);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const refresh = () => {
      setBriefs(null);
      setReload((n) => n + 1);
    };
    changes.forEach((name) => window.addEventListener(name, refresh));
    async function load() {
      setError("");
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Brief unavailable");
        const decoded = readBriefs(await response.json());
        if (controller.signal.aborted) return;
        setBriefs(decoded);
        setHasPilotFeedback(
          !!document.getElementById("first-improvement-pilot"),
        );
      } catch {
        if (!controller.signal.aborted)
          setError("Your brief couldn’t load. Try refreshing it.");
      }
    }
    void load();
    return () => {
      controller.abort();
      changes.forEach((name) => window.removeEventListener(name, refresh));
    };
  }, [open, reload]);

  const selected = selectedId
    ? briefs?.find((brief) => brief.observationId === selectedId)
    : briefs?.[0];
  const selectionMissing = !!(selectedId && briefs && !selected);

  function manualRefresh() {
    setNotice("");
    setBriefs(null);
    setReload((n) => n + 1);
  }

  function onSaved(id: string, decision: Decision) {
    setBriefs(
      (rows) =>
        rows?.map((row) =>
          row.observationId === id ? { ...row, decision } : row,
        ) ?? null,
    );
    setNotice("Decision saved privately.");
  }

  function onStale(message: string) {
    setNotice(message);
    setBriefs(null);
    setReload((n) => n + 1);
  }

  return (
    <section
      id="monthly-practice-brief"
      className="monthly-practice-brief"
      aria-labelledby={headingId}
    >
      <p className="eyebrow">Private workspace</p>
      <h3 id={headingId}>Monthly Practice Brief</h3>
      <p>Review one change in your practice and decide what to do next.</p>
      {!open ? (
        <button
          type="button"
          className="btn btn-primary practice-brief-open"
          onClick={() => {
            setNotice("");
            setBriefs(null);
            setOpen(true);
          }}
        >
          Open monthly brief
        </button>
      ) : (
        <>
          <div className="practice-brief-controls">
            <button
              type="button"
              className="quiet-button"
              onClick={manualRefresh}
            >
              Refresh brief
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                setNotice("");
                setBriefs(null);
                setOpen(false);
              }}
            >
              Close brief
            </button>
          </div>
          {notice && (
            <p role="status" className="practice-brief-notice">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          {!briefs && !error && (
            <p role="status">Loading your private brief…</p>
          )}
          {briefs?.length === 0 && (
            <div className="practice-brief-history">
              <p>
                {selectionMissing
                  ? "That tracked action is no longer available in your brief."
                  : "No tracked action is available yet. Register an improvement and its follow-up month to get a brief."}
              </p>
              <a href="#first-improvement">Set up an improvement</a>
            </div>
          )}
          {selectionMissing && !!briefs?.length && (
            <p role="status">
              That tracked action is unavailable. Choose another action to view
              its brief.
            </p>
          )}
          {briefs &&
            (briefs.length > 1 || (selectionMissing && briefs.length > 0)) && (
              <div className="field-label practice-brief-select">
                <label htmlFor={`${headingId}-action`}>
                  Action and follow-up month
                </label>
                <select
                  id={`${headingId}-action`}
                  value={selected?.observationId ?? ""}
                  onChange={(event) => {
                    setSelectedId(event.target.value);
                    setNotice("");
                  }}
                >
                  {selectionMissing && (
                    <option value="" disabled>
                      Choose an action
                    </option>
                  )}
                  {briefs.map((brief) => (
                    <option
                      key={brief.observationId}
                      value={brief.observationId}
                    >
                      {monthLabel(brief.window.startDate)} ·{" "}
                      {brief.action.title} · {statusCopy[brief.status].label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          {selected && (
            <BriefDetail brief={selected} onSaved={onSaved} onStale={onStale} />
          )}
          {hasPilotFeedback && (
            <p className="fine-print">
              Taking part in the pilot?{" "}
              <a href="#first-improvement-pilot">
                Give separate, optional pilot feedback
              </a>
              .
            </p>
          )}
        </>
      )}
    </section>
  );
}
