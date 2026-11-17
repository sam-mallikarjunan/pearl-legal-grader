"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CloudReport } from "../lib/account/types";
import { accountRecord, canonicalJson } from "../lib/account/validation";
import {
  ACTION_METRICS,
  ACTION_OBSERVATION_LIMIT,
  ACTION_OBSERVATION_PER_PLAN,
  ACTION_OBSERVATION_VERSION,
  decodeActionObservation,
  parseActionObservationInput,
  validateActionObservationRegistration,
  type ActionObservationView,
} from "../lib/action-observations";
import {
  improvementBaselines,
  improvementWindows,
} from "../lib/first-improvement";
import {
  decodeOutcomePlan,
  OUTCOME_PLAN_LIMIT,
  parseOutcomePlanInput,
  type OutcomePlan,
} from "../lib/outcome-plans";
import type { OutcomePeriod } from "../lib/outcomes";
import {
  buildProgressInsights,
  progressMetricDefinition,
  progressObservations,
  type ProgressMetricId,
} from "../lib/progress-insights";
import "./first-improvement.css";

const changes = [
  "grader:outcomes-changed",
  "grader:outcome-plans-changed",
  "grader:action-observations-changed",
] as const;
const outcomesPath = "/api/account/outcomes";
const plansPath = "/api/account/outcome-plans";
const observationsPath = "/api/account/action-observations";

type TrackerSummary = {
  observation: ActionObservationView["observation"];
  status: ActionObservationView["comparison"]["status"];
};
type Workspace = {
  releaseId: string;
  periods: OutcomePeriod[];
  plans: OutcomePlan[];
  tracks: TrackerSummary[];
};
const labels: Record<TrackerSummary["status"], string> = {
  waiting: "Wait for the follow-up month to close.",
  unreported: "The month is closed. Add figures for the registered period.",
  unknown: "Both periods need a known value to compare this measure.",
  descriptive: "A private before-and-after comparison is available.",
  baseline_changed: "The saved baseline changed. The comparison is withheld.",
  plan_unavailable: "The plan or original report is no longer available.",
  withdrawn: "Tracking was withdrawn.",
};
const writeErrors: Record<string, string> = {
  not_found: "A saved item was removed. Refresh and review your choices.",
  revision_conflict:
    "A saved item changed. Review the latest version before trying again.",
  outcome_plan_release_changed:
    "The scoring rubric changed. Save a fresh assessment before making a new plan.",
  outcome_plan_overlap:
    "This month was just reserved. Choose another open month or reuse an exact matching plan.",
  outcome_plan_baseline_invalid:
    "Save a current assessment dated within 90 days of the follow-up month.",
  action_observation_not_prospective:
    "The change or reporting month has already begun. Choose a future month.",
};
class FlowRequestError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
async function request(path: string, signal: AbortSignal, body?: unknown) {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value: unknown = await response.json();
  if (!response.ok || !accountRecord(value))
    throw new FlowRequestError(
      response.status === 401
        ? "signed_out"
        : accountRecord(value) && typeof value.code === "string"
          ? value.code
          : "unconfirmed",
    );
  return value;
}
function sourceLabel(value: OutcomePeriod["source"]) {
  return value === "export"
    ? "Export-informed totals"
    : "Owner-entered figures";
}
function formattedValue(metric: ProgressMetricId, n: number, currency: string) {
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  if (metric === "cost_per_client")
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(n / 100);
  return metric === "owner_admin_hours_day"
    ? number.format(n) + " hours/day"
    : number.format(n) + "%";
}
function registrationToken(
  ref: { current: { key: string; id: string } | null },
  body: unknown,
) {
  const key = canonicalJson(body);
  if (ref.current?.key !== key) ref.current = { key, id: crypto.randomUUID() };
  return ref.current.id;
}

export default function FirstImprovement({
  reports,
}: {
  reports: CloudReport[];
}) {
  const id = useId(),
    readRequest = useRef<AbortController | null>(null),
    writeRequest = useRef<AbortController | null>(null),
    planRetry = useRef<{ key: string; id: string } | null>(null),
    observationRetry = useRef<{ key: string; id: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [reportId, setReportId] = useState("");
  const [actionId, setActionId] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [metricId, setMetricId] = useState<ProgressMetricId | "">("");
  const [month, setMonth] = useState("");
  const [scopeReview, setScopeReview] = useState("");
  const [finalReview, setFinalReview] = useState("");
  const [saved, setSaved] = useState<TrackerSummary | null>(null);

  const load = useCallback(async () => {
    readRequest.current?.abort();
    const controller = new AbortController();
    readRequest.current = controller;
    try {
      const [outcomes, plans, tracks, config] = await Promise.all([
        request(outcomesPath, controller.signal),
        request(plansPath, controller.signal),
        request(observationsPath, controller.signal),
        request("/api/config/active", controller.signal),
      ]);
      if (
        !Array.isArray(outcomes.periods) ||
        !Array.isArray(plans.plans) ||
        plans.plans.length > OUTCOME_PLAN_LIMIT ||
        tracks.version !== ACTION_OBSERVATION_VERSION ||
        !Array.isArray(tracks.views) ||
        tracks.views.length > ACTION_OBSERVATION_LIMIT ||
        config.available !== true ||
        !accountRecord(config.release) ||
        typeof config.release.id !== "string"
      )
        throw new Error();
      const parsed = buildProgressInsights(outcomes.periods as OutcomePeriod[]);
      if (parsed.status === "invalid") throw new Error();
      const observations = tracks.views.map(
        (value: unknown): TrackerSummary => {
          if (
            !accountRecord(value) ||
            !accountRecord(value.comparison) ||
            typeof value.comparison.status !== "string" ||
            !Object.hasOwn(labels, value.comparison.status)
          )
            throw new Error();
          return {
            observation: decodeActionObservation(value.observation),
            status: value.comparison.status as TrackerSummary["status"],
          };
        },
      );
      if (controller.signal.aborted) return;
      const workspace: Workspace = {
        releaseId: config.release.id,
        periods: parsed.periods,
        plans: plans.plans.map(decodeOutcomePlan),
        tracks: observations,
      };
      setState(workspace);
      return workspace;
    } catch {
      if (controller.signal.aborted) return;
      setState(null);
      setError("The guided workspace could not load. Try refreshing.");
    }
  }, []);

  useEffect(() => {
    const reveal = () => {
      if (window.location.hash === "#first-improvement") setOpen(true);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onChange = () => void load();
    void load();
    changes.forEach((name) => window.addEventListener(name, onChange));
    return () => {
      readRequest.current?.abort();
      writeRequest.current?.abort();
      changes.forEach((name) => window.removeEventListener(name, onChange));
    };
  }, [open, load]);

  const now = new Date();
  const viableReports = state
    ? reports.filter(
        (r) =>
          r.canonical &&
          !r.snapshot.isSample &&
          r.snapshot.assessment.actions.length > 0 &&
          (r.snapshot.assessment.releaseId === state.releaseId ||
            state.plans.some(
              (p) =>
                p.baselineReportId === r.id &&
                p.status === "registered" &&
                Date.parse(p.startDate) > now.getTime(),
            )),
      )
    : [];
  const report =
    viableReports.find((r) => r.id === reportId) ?? viableReports[0];
  const tracked =
    state?.tracks.find((x) => x.observation.id === saved?.observation.id) ??
    saved ??
    state?.tracks.find((x) => x.observation.status === "registered");
  const actions =
    report?.snapshot.assessment.actions.filter((a) => {
      const progress = report.actionProgress.find((p) => p.actionId === a.id);
      return !progress || progress.state === "todo";
    }) ?? [];
  const action = actions.find((a) => a.id === actionId);
  const baselineChoices =
    report && state
      ? improvementBaselines(report, reports, state.periods, now)
      : [];
  const baseline = baselineChoices.find((p) => p.id === baselineId);
  const metrics = baseline ? progressObservations(baseline) : null;
  const chosenMetric = metricId && metrics ? metrics[metricId] : null;
  const windows =
    report && baseline && state
      ? improvementWindows(
          report,
          baseline,
          state.plans,
          state.periods,
          now,
        ).filter(
          (w) =>
            w.existingPlan ||
            report.snapshot.assessment.releaseId === state.releaseId,
        )
      : [];
  const selected = windows.find((w) => w.startDate === month);
  const selectedPlan = selected?.existingPlan;
  const planTracks = selectedPlan
    ? (state?.tracks.filter((t) => t.observation.planId === selectedPlan.id) ??
      [])
    : [];
  const alreadyTracked = planTracks.find(
    (track) => track.observation.action.id === actionId,
  );
  const noCapacity =
    (state?.tracks.length ?? 0) >= ACTION_OBSERVATION_LIMIT ||
    planTracks.length >= ACTION_OBSERVATION_PER_PLAN;
  const showScope = baseline?.baselineReportId === null;
  const scopeKey =
    report && baseline
      ? canonicalJson([report.id, baseline.id, baseline.revision])
      : "";
  const samePractice = scopeKey !== "" && scopeReview === scopeKey;
  const finalKey =
    scopeKey && action && metricId && selected
      ? canonicalJson([
          scopeKey,
          action.id,
          metricId,
          selected.startDate,
          selected.endDate,
          selectedPlan?.id ?? null,
          selectedPlan?.revision ?? null,
        ])
      : "";
  const confirmed = finalKey !== "" && finalReview === finalKey;
  const allowed = !!(
    report &&
    action &&
    baseline &&
    chosenMetric &&
    chosenMetric.value !== null &&
    selected &&
    (!showScope || samePractice) &&
    confirmed &&
    !alreadyTracked &&
    !noCapacity
  );

  function reviewAgain() {
    setFinalReview("");
    setError("");
    setStatus("");
    setSaved(null);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !allowed ||
      !report ||
      !baseline ||
      !state ||
      !metricId ||
      !selected ||
      !action ||
      writeRequest.current
    )
      return;
    const controller = new AbortController();
    writeRequest.current = controller;
    setSaving(true);
    setError("");
    setStatus("");
    let plan = selected.existingPlan;
    try {
      // Check candidate lineage before creating even the first record. The
      // existing native services still enforce revisions and owner identity.
      const localPlan: OutcomePlan = plan ?? {
        id: report.id,
        requestId: report.id,
        revision: 0,
        startDate: selected.startDate,
        endDate: selected.endDate,
        status: "registered",
        outcomeId: null,
        source: baseline.source,
        currency: baseline.currency,
        baselineReportId: report.id,
        baselineReleaseId: report.snapshot.assessment.releaseId,
        baselineStage: report.snapshot.assessment.contextSnapshot.stage,
        baselineFeeModel: report.snapshot.assessment.contextSnapshot.feeModel,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        reportedAt: null,
        withdrawnAt: null,
      };
      const linkedReport =
        reports.find((r) => r.id === baseline.baselineReportId) ?? null;
      const buildRegistration = (target: OutcomePlan) => ({
        planId: target.id,
        planRevision: target.revision,
        actionId: action.id,
        baselinePeriodId: baseline.id,
        baselineRevision: baseline.revision,
        metricId,
        changeStartDate: target.startDate,
        scopeDeclared: showScope && samePractice,
        confounders: ["unsure"],
        version: ACTION_OBSERVATION_VERSION,
      });
      validateActionObservationRegistration(
        parseActionObservationInput({
          ...buildRegistration(localPlan),
          requestId: report.id,
        }),
        localPlan,
        report,
        baseline,
        linkedReport,
      );
      if (!plan) {
        const body = {
          expectedReleaseId: state.releaseId,
          baselineReportId: report.id,
          startDate: selected.startDate,
          endDate: selected.endDate,
          source: baseline.source,
          currency: baseline.currency,
        };
        const input = parseOutcomePlanInput({
          ...body,
          requestId: registrationToken(planRetry, body),
        });
        const value = await request(plansPath, controller.signal, input);
        if (controller.signal.aborted) return;
        const registered = decodeOutcomePlan(value.plan);
        if (
          registered.requestId !== input.requestId ||
          registered.startDate !== input.startDate ||
          registered.endDate !== input.endDate ||
          registered.source !== input.source ||
          registered.currency !== input.currency ||
          registered.status !== "registered" ||
          registered.outcomeId !== null ||
          registered.baselineReleaseId !== input.expectedReleaseId ||
          registered.baselineReportId !== input.baselineReportId
        )
          throw new FlowRequestError("unconfirmed");
        plan = registered;
        setState(
          (v) =>
            v && {
              ...v,
              plans: [
                registered,
                ...v.plans.filter((p) => p.id !== registered.id),
              ],
            },
        );
        window.dispatchEvent(new Event(changes[1]));
      }
      if (controller.signal.aborted) return;
      const details = buildRegistration(plan);
      const input = parseActionObservationInput({
        ...details,
        requestId: registrationToken(observationRetry, details),
      });
      validateActionObservationRegistration(
        input,
        plan,
        report,
        baseline,
        linkedReport,
      );
      const value = await request(observationsPath, controller.signal, input);
      const observation = decodeActionObservation(value.observation);
      if (
        observation.requestId !== input.requestId ||
        observation.planId !== input.planId ||
        observation.action.id !== input.actionId ||
        observation.baseline.id !== input.baselinePeriodId ||
        observation.baseline.revision !== input.baselineRevision ||
        observation.metricId !== input.metricId ||
        observation.status !== "registered"
      )
        throw new FlowRequestError("unconfirmed");
      if (controller.signal.aborted) return;
      setSaved({ observation, status: "waiting" });
      setStatus(
        "Your private comparison is set up. Start on the date below and return after the month closes.",
      );
      setFinalReview("");
      setActionId("");
      setBaselineId("");
      setMetricId("");
      setMonth("");
      setScopeReview("");
      window.dispatchEvent(new Event(changes[2]));
    } catch (e) {
      if (controller.signal.aborted) return;
      const code = e instanceof FlowRequestError ? e.code : "";
      if (code === "signed_out") {
        setError(
          "Your session ended. Sign in again and review the saved month.",
        );
      } else {
        const reason = Object.hasOwn(writeErrors, code)
          ? writeErrors[code]
          : "The full registration could not be confirmed.";
        setError(
          reason +
            (plan
              ? " The reporting month is already saved. Review your choices and retry to use that same month."
              : " Refresh to check whether the reporting month was saved before trying again."),
        );
      }
      setFinalReview("");
      void load();
    } finally {
      if (writeRequest.current === controller) writeRequest.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  function refresh() {
    setError("");
    setFinalReview("");
    void load();
  }

  return (
    <section
      id="first-improvement"
      className="first-improvement"
      aria-labelledby={`${id}-title`}
    >
      <p className="eyebrow">GUIDED WORKSPACE</p>
      <h3 id={`${id}-title`}>Make one improvement and see what changes</h3>
      <p>
        Choose one action from your report, a number you already measure and a
        month to follow up.
      </p>
      {!open ? (
        <button
          type="button"
          className="btn btn-primary"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          Open first improvement guide
        </button>
      ) : (
        <>
          <div className="button-row">
            <button
              type="button"
              className="quiet-button"
              onClick={refresh}
              disabled={saving}
            >
              Refresh guide
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Close guide
            </button>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {status && (
            <p className="guide-note" role="status">
              {status}
            </p>
          )}
          {!state && !error && (
            <p role="status">Loading your private reports and measures…</p>
          )}
          {tracked && (
            <div className="guide-note">
              <h4>Your tracked action: {tracked.observation.action.title}</h4>
              <p>
                <strong>
                  {
                    ACTION_METRICS.find(
                      (m) => m.id === tracked.observation.metricId,
                    )?.label
                  }
                </strong>{" "}
                · {tracked.observation.window.startDate} to{" "}
                {tracked.observation.window.endDate} (UTC)
              </p>
              {tracked.status === "waiting" && (
                <p>
                  Planned start: {tracked.observation.changeStartDate} (UTC).
                </p>
              )}
              <p>{labels[tracked.status]}</p>
              <div className="button-row">
                <a className="text-link" href="#action-outcome-tracking">
                  Open action tracking
                </a>
                {tracked.status === "waiting" && (
                  <a className="text-link" href="#outcome-reporting-reminders">
                    Choose optional reporting reminders
                  </a>
                )}
                {tracked.status === "unreported" && (
                  <a className="text-link" href="#business-outcomes">
                    Report this month’s numbers
                  </a>
                )}
                {tracked.status === "unreported" &&
                  tracked.observation.window.source === "export" && (
                    <a className="text-link" href="#data-integrations">
                      Review delivered totals
                    </a>
                  )}
              </div>
            </div>
          )}
          {state && viableReports.length === 0 && (
            <p className="guide-note">
              First,{" "}
              <a href="/" className="text-link">
                complete an assessment
              </a>{" "}
              and save its report to this account. The guide needs a current
              report with an issued action.
            </p>
          )}
          {state && viableReports.length > 0 && (
            <form onSubmit={(event) => void submit(event)}>
              <fieldset disabled={saving} className="first-improvement-step">
                <legend>1. Pick one action from a saved report</legend>
                <div className="first-improvement-grid">
                  <label className="field-label">
                    Saved report
                    <select
                      aria-label="Saved report"
                      value={report?.id ?? ""}
                      onChange={(event) => {
                        setReportId(event.target.value);
                        setActionId("");
                        setBaselineId("");
                        setMetricId("");
                        setMonth("");
                        setScopeReview("");
                        reviewAgain();
                      }}
                    >
                      <option value="" disabled>
                        Select a report
                      </option>
                      {viableReports.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.snapshot.label} ·{" "}
                          {r.snapshot.createdAt.slice(0, 10)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Issued action
                    <select
                      aria-label="Issued action"
                      value={action?.id ?? ""}
                      disabled={!actions.length}
                      onChange={(event) => {
                        setActionId(event.target.value);
                        reviewAgain();
                      }}
                    >
                      <option value="">
                        Select an action you have not started
                      </option>
                      {actions.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {!actions.length && (
                  <p>
                    No unstarted actions are available on this report. Try
                    another report or open{" "}
                    <a href="#action-outcome-tracking">existing tracking</a>.
                  </p>
                )}
                {action && (
                  <div className="guide-note">
                    <p>{action.summary}</p>
                    <p>
                      <strong>What done looks like:</strong>{" "}
                      {action.definitionOfDone}
                    </p>
                    <p>
                      <strong>How to verify:</strong> {action.verification}
                    </p>
                  </div>
                )}
              </fieldset>
              {report && action && (
                <fieldset disabled={saving} className="first-improvement-step">
                  <legend>2. Choose the number to compare</legend>
                  <p>
                    Use a closed calendar month from before the change. The
                    follow-up uses the same source and currency.
                  </p>
                  {!baselineChoices.length && (
                    <div className="guide-note">
                      <p>
                        No compatible month with a measured value is saved yet.
                        Add totals for one closed calendar month, then refresh
                        the guide.
                      </p>
                      <div className="button-row">
                        <a href="#business-outcomes" className="text-link">
                          Enter a month’s totals
                        </a>
                        <a
                          href="#import-business-outcomes"
                          className="text-link"
                        >
                          Import aggregate totals
                        </a>
                        <a href="#data-integrations" className="text-link">
                          Review delivered totals
                        </a>
                      </div>
                    </div>
                  )}
                  {!!baselineChoices.length && (
                    <div className="first-improvement-grid">
                      <label className="field-label">
                        Closed baseline month
                        <select
                          aria-label="Closed baseline month"
                          value={baseline?.id ?? ""}
                          onChange={(event) => {
                            setBaselineId(event.target.value);
                            setMetricId("");
                            setMonth("");
                            setScopeReview("");
                            reviewAgain();
                          }}
                        >
                          <option value="">Select a month</option>
                          {baselineChoices.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.startDate} to {p.endDate} · {p.currency} ·{" "}
                              {sourceLabel(p.source)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field-label">
                        Measure to follow
                        <select
                          aria-label="Measure to follow"
                          value={metricId}
                          disabled={!metrics}
                          onChange={(event) => {
                            const next = ACTION_METRICS.find(
                              (m) => m.id === event.target.value,
                            );
                            setMetricId(next?.id ?? "");
                            reviewAgain();
                          }}
                        >
                          <option value="">Choose one known measure</option>
                          {metrics &&
                            ACTION_METRICS.filter(
                              (m) => metrics[m.id].value !== null,
                            ).map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                  )}
                  {baseline && metricId && chosenMetric?.value != null && (
                    <p>
                      <strong>
                        Baseline:{" "}
                        {formattedValue(
                          metricId,
                          chosenMetric.value,
                          baseline.currency,
                        )}
                      </strong>{" "}
                      · {progressMetricDefinition(metricId)}
                    </p>
                  )}
                  {showScope && (
                    <label className="first-improvement-choice">
                      <input
                        type="checkbox"
                        checked={samePractice}
                        onChange={(event) => {
                          setScopeReview(event.target.checked ? scopeKey : "");
                          reviewAgain();
                        }}
                      />
                      <span>
                        I confirm this unlinked month describes the same
                        practice and measurement definitions as the selected
                        report.
                      </span>
                    </label>
                  )}
                </fieldset>
              )}
              {report && action && baseline && chosenMetric?.value != null && (
                <fieldset disabled={saving} className="first-improvement-step">
                  <legend>3. Set a month to try the action</legend>
                  <label className="field-label">
                    Future calendar month
                    <select
                      aria-label="Future calendar month"
                      value={selected?.startDate ?? ""}
                      onChange={(event) => {
                        setMonth(event.target.value);
                        reviewAgain();
                      }}
                    >
                      <option value="">Select a future month</option>
                      {windows.map((w) => (
                        <option key={w.startDate} value={w.startDate}>
                          {w.startDate} to {w.endDate}
                          {w.existingPlan ? " · reuse registered plan" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!windows.length && (
                    <p>
                      No eligible month is available. A new plan needs a current
                      assessment no more than 90 days before the month starts.
                      Check <a href="#outcome-plans">your reporting plans</a>{" "}
                      for reserved months.
                    </p>
                  )}
                  {selected && (
                    <div className="guide-note">
                      <p>
                        Start <strong>{action.title}</strong> on{" "}
                        <strong>{selected.startDate} (UTC)</strong>, then report
                        the same numbers after{" "}
                        <strong>{selected.endDate}</strong>. The dates, baseline
                        and measure are locked when saved.
                      </p>
                      {selectedPlan && (
                        <p>You’ll reuse the matching registered period.</p>
                      )}
                      {alreadyTracked && (
                        <p>
                          This action already has a tracking record for this
                          month.{" "}
                          <a href="#action-outcome-tracking">
                            Open action tracking
                          </a>{" "}
                          to see its status.
                        </p>
                      )}
                      {!alreadyTracked && noCapacity && (
                        <p>
                          This workspace or month has reached its tracking
                          limit. Existing records remain available.
                        </p>
                      )}
                      {!alreadyTracked && !noCapacity && (
                        <label className="first-improvement-choice">
                          <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(event) =>
                              setFinalReview(
                                event.target.checked ? finalKey : "",
                              )
                            }
                          />
                          <span>
                            I have not started this change. I reviewed the
                            measure and dates and want to register this private
                            comparison.
                          </span>
                        </label>
                      )}
                    </div>
                  )}
                  <p className="fine-print">
                    Saving does not change your grade or sharing choices. A
                    before-and-after comparison can show what changed, but not
                    what caused it.
                  </p>
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={!allowed || saving}
                  >
                    {saving
                      ? "Saving private comparison…"
                      : "Save plan and track this action"}
                  </button>
                </fieldset>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}
