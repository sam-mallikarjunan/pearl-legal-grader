"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CloudReport } from "../lib/account/types";
import { accountRecord } from "../lib/account/validation";
import { decodeOutcomePlan, type OutcomePlan } from "../lib/outcome-plans";
import type { OutcomePeriod } from "../lib/outcomes";
import {
  buildProgressInsights,
  progressObservations,
  progressWindowKind,
} from "../lib/progress-insights";
import {
  ACTION_CONFOUNDERS,
  ACTION_CONFOUNDER_LABELS,
  ACTION_IMPLEMENTATIONS,
  ACTION_METRICS,
  ACTION_OBSERVATION_VERSION,
  parseActionCheckIn,
  parseActionObservationInput,
  validateActionObservationRegistration,
  type ActionObservation,
  type ActionObservationInput,
  type ActionObservationView,
} from "../lib/action-observations";
import "./action-observations.css";
const implementationLabels: Record<
  ActionObservation["implementation"],
  string
> = {
  unreported: "Not yet reported",
  not_started: "Not started",
  started_as_planned: "I started as planned",
  started_late: "I started later than planned",
  not_implemented: "I did not implement this change",
  unsure: "I’m not sure",
};
const statusLabels: Record<
  ActionObservationView["comparison"]["status"],
  string
> = {
  withdrawn: "Tracking withdrawn",
  plan_unavailable: "Registered plan or report unavailable",
  baseline_changed: "Original baseline changed or removed",
  waiting: "Waiting for the registered month to end",
  unreported: "Registered month needs its outcome report",
  unknown: "Follow-up measure unknown or unavailable",
  descriptive: "Recorded before-and-after values",
};
function Factors({
  id,
  values,
  onChange,
  disabled,
  legend,
}: {
  id: string;
  values: ActionObservationInput["confounders"];
  onChange: (v: ActionObservationInput["confounders"]) => void;
  disabled: boolean;
  legend: string;
}) {
  return (
    <fieldset className="action-observation-factors" disabled={disabled}>
      <legend>{legend}</legend>
      {ACTION_CONFOUNDERS.map((f) => (
        <label key={f} htmlFor={`${id}-${f}`}>
          <input
            id={`${id}-${f}`}
            type="checkbox"
            checked={values.includes(f)}
            onChange={() => {
              if (f === "none_reported" || f === "unsure") onChange([f]);
              else {
                const next = values.filter(
                  (v) => v !== "none_reported" && v !== "unsure" && v !== f,
                );
                if (!values.includes(f)) next.push(f);
                onChange(next.length ? next : ["unsure"]);
              }
            }}
          />
          <span>{ACTION_CONFOUNDER_LABELS[f]}</span>
        </label>
      ))}
    </fieldset>
  );
}
function CheckIn({
  view,
  disabled,
  onSave,
}: {
  view: ActionObservationView;
  disabled: boolean;
  onSave: (
    o: ActionObservation,
    implementation: ActionObservation["implementation"],
    confounders: ActionObservationInput["confounders"],
  ) => void;
}) {
  const id = useId(),
    o = view.observation;
  const [implementation, setImplementation] = useState(o.implementation),
    [factors, setFactors] = useState(o.confounders);
  useEffect(() => {
    setImplementation(o.implementation);
    setFactors(o.confounders);
  }, [o.implementation, o.confounders]);
  return (
    <details>
      <summary>Record what you did and what else changed</summary>
      <p>
        This check-in records your account of implementation. It does not
        complete the issued action or verify when work happened. Start claims
        are available on or after the planned change date.
      </p>
      <label className="field-label" htmlFor={`${id}-implementation`}>
        Implementation claim
        <select
          id={`${id}-implementation`}
          aria-label="Implementation claim"
          value={implementation}
          disabled={disabled}
          onChange={(e) =>
            setImplementation(e.target.value as typeof implementation)
          }
        >
          {ACTION_IMPLEMENTATIONS.map((v) => (
            <option key={v} value={v}>
              {implementationLabels[v]}
            </option>
          ))}
        </select>
      </label>
      <Factors
        id={id}
        values={factors}
        onChange={setFactors}
        disabled={disabled}
        legend="Other influences during the window"
      />
      <button
        type="button"
        className="btn btn-secondary btn-small"
        disabled={disabled}
        onClick={() => onSave(o, implementation, factors)}
      >
        Save implementation check-in
      </button>
    </details>
  );
}
function metricValue(v: number | null, metric: string, currency: string) {
  if (v === null) return "Unknown / undefined";
  return metric === "inquiry_conversion" || metric === "invoice_collection"
    ? `${v.toFixed(1)}%`
    : metric === "cost_per_client"
      ? `${(v / 100).toFixed(2)} ${currency} / client`
      : `${v.toFixed(2)} owner hours / calendar day`;
}
export default function ActionObservations({
  reports,
}: {
  reports: CloudReport[];
}) {
  const id = useId(),
    generation = useRef(0),
    request = useRef<{ key: string; id: string } | null>(null),
    writing = useRef(false);
  const [views, setViews] = useState<ActionObservationView[]>([]),
    [plans, setPlans] = useState<OutcomePlan[]>([]),
    [periods, setPeriods] = useState<OutcomePeriod[]>([]),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [planId, setPlanId] = useState(""),
    [actionId, setActionId] = useState(""),
    [baselineId, setBaselineId] = useState(""),
    [metricId, setMetricId] = useState(""),
    [changeDate, setChangeDate] = useState(""),
    [scope, setScope] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [factors, setFactors] = useState<ActionObservationInput["confounders"]>([
      "unsure",
    ]),
    [withdrawId, setWithdrawId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const run = ++generation.current;
    try {
      const responses = await Promise.all([
        fetch("/api/account/action-observations", {
          cache: "no-store",
          credentials: "same-origin",
        }),
        fetch("/api/account/outcome-plans", {
          cache: "no-store",
          credentials: "same-origin",
        }),
        fetch("/api/account/outcomes", {
          cache: "no-store",
          credentials: "same-origin",
        }),
      ]);
      const [a, p, o]: unknown[] = await Promise.all(
        responses.map((r) => r.json()),
      );
      if (
        responses.some((r) => !r.ok) ||
        !accountRecord(a) ||
        a.version !== ACTION_OBSERVATION_VERSION ||
        !Array.isArray(a.views) ||
        a.views.length > 72 ||
        !accountRecord(p) ||
        !Array.isArray(p.plans) ||
        !accountRecord(o) ||
        !Array.isArray(o.periods)
      )
        throw new Error();
      const parsed = buildProgressInsights(o.periods as OutcomePeriod[]);
      if (parsed.status === "invalid") throw new Error();
      if (run !== generation.current) return;
      setViews(a.views as ActionObservationView[]);
      setPlans(p.plans.map(decodeOutcomePlan));
      setPeriods(parsed.periods);
      setLoaded(true);
    } catch {
      if (run !== generation.current) return;
      setLoaded(false);
      setMessage(
        "Private action tracking could not load. Refresh before registering or updating anything.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
    const changed = (e: Event) => {
      if ((e as CustomEvent).detail?.source !== "action-observations")
        void load();
    };
    window.addEventListener("grader:outcomes-changed", changed);
    window.addEventListener("grader:outcome-plans-changed", changed);
    window.addEventListener("grader:action-observations-changed", changed);
    return () => {
      generation.current++;
      window.removeEventListener("grader:outcomes-changed", changed);
      window.removeEventListener("grader:outcome-plans-changed", changed);
      window.removeEventListener("grader:action-observations-changed", changed);
    };
  }, [load]);
  const now = new Date(),
    today = now.toISOString().slice(0, 10),
    future = plans.filter(
      (p) =>
        p.status === "registered" &&
        p.startDate > today &&
        progressWindowKind(p) === "calendar_month",
    );
  const plan = future.find((p) => p.id === planId),
    report = plan
      ? reports.find(
          (r) =>
            r.id === plan.baselineReportId &&
            r.canonical === true &&
            !r.snapshot.isSample,
        )
      : null,
    baseline = periods.find((p) => p.id === baselineId);
  const candidates = plan
    ? periods.filter(
        (p) =>
          p.source === plan.source &&
          p.currency === plan.currency &&
          progressWindowKind(p) === "calendar_month" &&
          p.endDate < today,
      )
    : [];
  function resetSelection() {
    setActionId("");
    setBaselineId("");
    setMetricId("");
    setScope(false);
    setReviewed(false);
    setFactors(["unsure"]);
    request.current = null;
  }
  async function write(
    path: string,
    method: string,
    body: unknown,
    success: string,
  ) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      const v = await r.json();
      if (!r.ok)
        throw new Error(
          v.error ||
            "This change could not be confirmed. Refresh before retrying.",
        );
      await load();
      setMessage(success);
      window.dispatchEvent(
        new CustomEvent("grader:action-observations-changed", {
          detail: { source: "action-observations" },
        }),
      );
      return true;
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "The change could not be confirmed. Refresh before retrying.",
      );
      await load();
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function register() {
    if (!plan || !report || !baseline || !reviewed || !metricId) return;
    try {
      const body = {
        planId: plan.id,
        planRevision: plan.revision,
        actionId,
        baselinePeriodId: baseline.id,
        baselineRevision: baseline.revision,
        metricId,
        changeStartDate: changeDate,
        scopeDeclared: scope,
        confounders: factors,
        version: ACTION_OBSERVATION_VERSION,
      };
      const key = JSON.stringify(body);
      if (request.current?.key !== key)
        request.current = { key, id: crypto.randomUUID() };
      const input = parseActionObservationInput({
        requestId: request.current.id,
        ...body,
      });
      validateActionObservationRegistration(
        input,
        plan,
        report,
        baseline,
        baseline.baselineReportId
          ? (reports.find((r) => r.id === baseline.baselineReportId) ?? null)
          : null,
      );
      if (
        await write(
          "/api/account/action-observations",
          "POST",
          input,
          "Private tracking registered before its change date. The measure and baseline are fixed; your grade and permissions are unchanged.",
        )
      ) {
        setPlanId("");
        setChangeDate("");
        resetSelection();
      }
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Review the registration details.",
      );
    }
  }
  async function checkIn(
    o: ActionObservation,
    implementation: ActionObservation["implementation"],
    confounders: ActionObservationInput["confounders"],
  ) {
    try {
      const body = parseActionCheckIn(
        { revision: o.revision, implementation, confounders },
        o.changeStartDate,
      );
      await write(
        `/api/account/action-observations/${o.id}`,
        "PATCH",
        body,
        "Your implementation claim and other factors were recorded. This is not independent verification or a score change.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Review the check-in.");
    }
  }
  return (
    <section
      id="action-outcome-tracking"
      className="account-subsection action-observations"
      aria-labelledby={`${id}-title`}
    >
      <p className="eyebrow">PRIVATE · PLAN BEFORE YOU CHANGE</p>
      <h3 id={`${id}-title`}>
        Track an action against a future business period
      </h3>
      <p>
        Choose one issued action, one known baseline month and one measure
        before a future reporting month begins. Later, see the recorded values
        alongside what you say you implemented and what else changed. This
        cannot prove that an action caused a result.
      </p>
      <p className="fine-print">
        Private tracking does not change grades, action completion, research,
        leaderboard, contact or email permissions. At most 72 registrations per
        account and three per reporting plan. Withdrawal does not reopen a slot
        or replace the fixed measure.
      </p>
      <button
        type="button"
        className="quiet-button"
        disabled={busy}
        onClick={() => void load()}
      >
        Refresh action tracking
      </button>
      {loaded && (
        <details className="action-observation-registration">
          <summary>Register a future action observation</summary>
          <p>
            First <a href="#outcome-plans">register a future calendar month</a>{" "}
            and <a href="#business-outcomes">save a closed baseline month</a>.
            Their source, currency and month definitions must match. Existing
            progress dates do not count as prospective registration.
          </p>
          <div className="field-grid">
            <label className="field-label" htmlFor={`${id}-plan`}>
              Future reporting plan
              <select
                id={`${id}-plan`}
                aria-label="Future reporting plan"
                value={plan?.id ?? ""}
                disabled={busy}
                onChange={(e) => {
                  setPlanId(e.target.value);
                  resetSelection();
                  setChangeDate(
                    future.find((p) => p.id === e.target.value)?.startDate ??
                      "",
                  );
                }}
              >
                <option value="">Choose a future calendar month</option>
                {future.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.startDate} to {p.endDate} · {p.currency} · {p.source}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label" htmlFor={`${id}-action`}>
              Issued action to observe
              <select
                id={`${id}-action`}
                aria-label="Issued action to observe"
                value={actionId}
                disabled={busy || !report}
                onChange={(e) => {
                  setActionId(e.target.value);
                  setReviewed(false);
                }}
              >
                <option value="">Choose from the plan’s baseline report</option>
                {report?.snapshot.assessment.actions.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label" htmlFor={`${id}-baseline`}>
              Closed baseline month
              <select
                id={`${id}-baseline`}
                aria-label="Closed baseline month"
                value={baselineId}
                disabled={busy || !plan}
                onChange={(e) => {
                  setBaselineId(e.target.value);
                  setScope(false);
                  setReviewed(false);
                }}
              >
                <option value="">Choose known aggregate records</option>
                {candidates.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.startDate} to {p.endDate} ·{" "}
                    {p.baselineReportId
                      ? "linked baseline"
                      : "unlinked owner period"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label" htmlFor={`${id}-metric`}>
              Fixed measure
              <select
                id={`${id}-metric`}
                aria-label="Fixed measure"
                value={metricId}
                disabled={busy || !baseline}
                onChange={(e) => {
                  setMetricId(e.target.value);
                  setReviewed(false);
                }}
              >
                <option value="">Choose one known baseline measure</option>
                {ACTION_METRICS.map((m) => (
                  <option
                    value={m.id}
                    key={m.id}
                    disabled={
                      baseline
                        ? progressObservations(baseline)[m.id].value === null
                        : true
                    }
                  >
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label" htmlFor={`${id}-change`}>
              Planned change start date
              <input
                id={`${id}-change`}
                type="date"
                value={changeDate}
                disabled={busy || !plan}
                min={new Date(now.getTime() + 86400000)
                  .toISOString()
                  .slice(0, 10)}
                max={plan?.startDate}
                onChange={(e) => {
                  setChangeDate(e.target.value);
                  setReviewed(false);
                }}
              />
            </label>
          </div>
          {report && (
            <p className="fine-print">
              Action source: {report.snapshot.label} · assessed{" "}
              {report.snapshot.createdAt.slice(0, 10)} · rubric{" "}
              {report.snapshot.assessment.releaseId}. Its issued template and
              grade remain unchanged.
            </p>
          )}
          {baseline && metricId && (
            <p className="fine-print">
              Chosen baseline value:{" "}
              {metricValue(
                progressObservations(baseline)[
                  metricId as ActionObservation["metricId"]
                ].value,
                metricId,
                baseline.currency,
              )}
              . The registration will freeze this measure and baseline revision{" "}
              {baseline.revision}; later baseline revisions or deletion stop the
              comparison.
            </p>
          )}
          {baseline?.baselineReportId === null && (
            <label className="action-observation-choice">
              <input
                type="checkbox"
                checked={scope}
                disabled={busy}
                onChange={(e) => {
                  setScope(e.target.checked);
                  setReviewed(false);
                }}
              />
              <span>
                I confirm this unlinked baseline describes the same practice and
                measurement definitions as the selected plan. This is my
                declaration, not an independently verified match.
              </span>
            </label>
          )}
          <Factors
            id={`${id}-initial`}
            values={factors}
            onChange={(v) => {
              setFactors(v);
              setReviewed(false);
            }}
            disabled={busy}
            legend="Other influences already expected"
          />
          <label className="action-observation-choice">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            <span>
              I reviewed the action, baseline, measure and future dates. Freeze
              this private registration before the change begins; compare only
              its registered follow-up month.
            </span>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              busy ||
              !plan ||
              !report ||
              !actionId ||
              !baseline ||
              !metricId ||
              !changeDate ||
              !reviewed ||
              (baseline.baselineReportId === null && !scope)
            }
            onClick={() => void register()}
          >
            Register private action observation
          </button>
        </details>
      )}
      {loaded && !views.length && (
        <p>
          No action observation is registered. A future plan can wait until you
          have a known baseline; unknown values are not failures.
        </p>
      )}
      <div className="action-observation-list">
        {views.map((view) => {
          const o = view.observation,
            c = view.comparison;
          return (
            <article key={o.id} className="action-observation-card">
              <p className="eyebrow">{statusLabels[c.status]}</p>
              <h4>{o.action.title}</h4>
              <p>
                {ACTION_METRICS.find((m) => m.id === o.metricId)?.label} ·{" "}
                {o.window.source} · {o.window.currency}
              </p>
              <p>
                Change planned for {o.changeStartDate}. Server registered{" "}
                {new Date(o.createdAt).toLocaleString()} before the change and
                reporting month.
              </p>
              <dl>
                <div>
                  <dt>
                    Frozen baseline · {o.baseline.startDate} to{" "}
                    {o.baseline.endDate}
                  </dt>
                  <dd>
                    {metricValue(
                      c.baseline.value,
                      o.metricId,
                      o.window.currency,
                    )}{" "}
                    ({c.baseline.numerator}/{c.baseline.denominator}) · baseline
                    revision {o.baseline.revision}
                  </dd>
                </div>
                <div>
                  <dt>
                    Registered follow-up · {o.window.startDate} to{" "}
                    {o.window.endDate}
                  </dt>
                  <dd>
                    {c.followup
                      ? `${metricValue(c.followup.value, o.metricId, o.window.currency)} (${c.followup.numerator ?? "unknown"}/${c.followup.denominator ?? "unknown"}) · revision ${c.followupRevision}`
                      : "No matched closed follow-up value yet"}
                  </dd>
                </div>
              </dl>
              {c.delta !== null && (
                <p>
                  <strong>Recorded value is {c.direction}.</strong> Change:{" "}
                  {o.metricId === "inquiry_conversion" ||
                  o.metricId === "invoice_collection"
                    ? `${c.delta.toFixed(1)} percentage points`
                    : metricValue(c.delta, o.metricId, o.window.currency)}
                  . This is an observation, not the action’s measured effect.
                </p>
              )}
              <p>
                Implementation claim: {implementationLabels[o.implementation]}
                {o.implementationRecordedAt
                  ? ` · recorded ${new Date(o.implementationRecordedAt).toLocaleString()}`
                  : ""}
                .
              </p>
              <ul>
                {c.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
              <details>
                <summary>
                  Original completion and measurement definition
                </summary>
                <p>{o.action.definitionOfDone}</p>
                <p>{o.action.verification}</p>
              </details>
              {o.status === "registered" && (
                <>
                  <CheckIn
                    view={view}
                    disabled={busy}
                    onSave={(...args) => void checkIn(...args)}
                  />
                  {withdrawId === o.id ? (
                    <div className="action-observation-buttons">
                      <p>
                        Stop comparing this registration? Its fixed record and
                        minimal audit remain private. The reporting plan, issued
                        action and other permissions stay unchanged.
                      </p>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={busy}
                        onClick={() =>
                          void write(
                            `/api/account/action-observations/${o.id}`,
                            "DELETE",
                            { revision: o.revision },
                            "Tracking withdrawn. Its original registration remains in your private history.",
                          ).then((ok) => {
                            if (ok) setWithdrawId(null);
                          })
                        }
                      >
                        Confirm withdraw tracking
                      </button>
                      <button
                        type="button"
                        className="quiet-button"
                        disabled={busy}
                        onClick={() => setWithdrawId(null)}
                      >
                        Keep tracking
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="quiet-button"
                      disabled={busy}
                      onClick={() => setWithdrawId(o.id)}
                    >
                      Withdraw this tracking registration
                    </button>
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
