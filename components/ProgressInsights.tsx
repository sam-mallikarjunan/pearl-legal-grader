"use client";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CloudReport } from "../lib/account/types";
import type { OutcomePeriod } from "../lib/outcomes";
import {
  buildProgressInsights,
  buildReassessmentInsights,
  progressMetricDefinition,
  progressObservations,
  progressPeriodLabel,
  type ProgressMetricId,
  type ProgressObservation,
} from "../lib/progress-insights";
import "./progress-insights.css";
const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n / 100);
const source = (s: string) =>
  s === "export" ? "Export-informed owner report" : "Owner-entered figures";
const stamp = (s: string) => new Date(s).toLocaleString();
function value(id: ProgressMetricId, v: ProgressObservation, currency: string) {
  return v.value === null
    ? "Unknown / undefined"
    : id === "inquiry_conversion" || id === "invoice_collection"
      ? `${number(v.value)}%`
      : id === "cost_per_client"
        ? `${money(v.value, currency)} / client`
        : `${number(v.value)} hours / calendar day`;
}
function fraction(
  id: ProgressMetricId,
  v: ProgressObservation,
  currency: string,
) {
  const n = v.numerator,
    d = v.denominator;
  if (id === "invoice_collection")
    return `${n === null ? "Unknown collections" : money(n, currency) + " collected"} / ${d === null ? "unknown billed amount" : money(d, currency) + " issued invoices"}`;
  if (id === "cost_per_client")
    return `${n === null ? "Unknown spend" : money(n, currency) + " acquisition spend"} / ${d === null ? "unknown client count" : number(d) + " retained clients"}`;
  if (id === "owner_admin_hours_day")
    return `${n === null ? "Unknown hours" : number(n) + " owner hours"} / ${d === null ? "unknown days" : number(d) + " calendar days"}`;
  return `${n === null ? "Unknown clients" : number(n) + " retained clients"} / ${d === null ? "unknown inquiries" : number(d) + " new inquiries"}`;
}
function delta(id: ProgressMetricId, n: number | null, currency: string) {
  if (n === null) return "Change unavailable";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const absolute = Math.abs(n);
  const amount = absolute > 0 && absolute < 0.001 ? "<0.001" : number(absolute);
  return id === "inquiry_conversion" || id === "invoice_collection"
    ? `${sign}${amount} percentage points`
    : id === "cost_per_client"
      ? `${sign}${money(absolute, currency)} / client`
      : `${sign}${amount} hours / calendar day`;
}
function PeriodFacts({
  period,
  title,
}: {
  period: OutcomePeriod;
  title: string;
}) {
  return (
    <article className="progress-period">
      <h4>{title}</h4>
      <p>
        <strong>{progressPeriodLabel(period)}</strong>
      </p>
      <p>
        {source(period.source)} · {period.currency}
      </p>
      <dl>
        <div>
          <dt>Inquiries first received</dt>
          <dd>
            {period.inquiries === null ? "Unknown" : number(period.inquiries)}
          </dd>
        </div>
        <div>
          <dt>Retained from those inquiries</dt>
          <dd>
            {period.clients === null ? "Unknown" : number(period.clients)}
          </dd>
        </div>
        <div>
          <dt>Owner administration</dt>
          <dd>
            {period.adminHours === null
              ? "Unknown"
              : `${number(period.adminHours)} hours`}
          </dd>
        </div>
      </dl>
      <p className="fine-print">
        Saved {stamp(period.createdAt)} · Last changed {stamp(period.updatedAt)}{" "}
        · Revision {period.revision}. Corrected numbers can change this view.
      </p>
    </article>
  );
}
export default function ProgressInsights({
  reports,
}: {
  reports: CloudReport[];
}) {
  const id = useId(),
    request = useRef(0);
  const [periods, setPeriods] = useState<OutcomePeriod[]>([]),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [currentId, setCurrentId] = useState(""),
    [previousId, setPreviousId] = useState("");
  const [currentReportId, setCurrentReportId] = useState(""),
    [previousReportId, setPreviousReportId] = useState("");
  const load = useCallback(async () => {
    const run = ++request.current;
    setBusy(true);
    try {
      const r = await fetch("/api/account/outcomes", { cache: "no-store" }),
        v = await r.json();
      if (!r.ok || !Array.isArray(v.periods))
        throw new Error(v.error || "Your private progress could not load.");
      if (run !== request.current) return;
      setPeriods(v.periods);
      setLoaded(true);
      setMessage("");
      setCurrentId((old) =>
        v.periods.some((p: OutcomePeriod) => p.id === old) ? old : "",
      );
      setPreviousId((old) =>
        v.periods.some((p: OutcomePeriod) => p.id === old) ? old : "",
      );
    } catch (e) {
      if (run !== request.current) return;
      setPeriods([]);
      setLoaded(false);
      setMessage(
        e instanceof Error
          ? e.message
          : "Your private progress could not load.",
      );
    } finally {
      if (run === request.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("grader:outcomes-changed", refresh);
    window.addEventListener("grader:outcome-plans-changed", refresh);
    return () => {
      request.current++;
      window.removeEventListener("grader:outcomes-changed", refresh);
      window.removeEventListener("grader:outcome-plans-changed", refresh);
    };
  }, [load]);
  const insight = useMemo(
    () =>
      buildProgressInsights(
        periods,
        currentId || undefined,
        previousId || undefined,
        reports,
      ),
    [periods, currentId, previousId, reports],
  );
  const reassessment = useMemo(
    () =>
      buildReassessmentInsights(
        reports,
        currentReportId || undefined,
        previousReportId || undefined,
      ),
    [reports, currentReportId, previousReportId],
  );
  const comparison = reassessment.comparison;
  const history = insight.history.slice(-12);
  return (
    <section
      id="private-progress"
      className="progress-insights"
      aria-labelledby={`${id}-title`}
    >
      <p className="eyebrow">YOUR PRIVATE PROGRESS</p>
      <div className="progress-heading">
        <h2 id={`${id}-title`}>What changed between your periods?</h2>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? "Refreshing…" : "Refresh private progress"}
        </button>
      </div>
      <p>
        Compare the figures you recorded for the same practice and definitions.
        These are owner observations, including export-informed reports. They
        are not independently verified, representative benchmarks or proof that
        an action caused a result.
      </p>
      <p className="fine-print">
        This view stays in your signed-in account. It does not change saved
        grades, research permissions, leaderboard choices or email settings.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {!loaded ? (
        <p>
          {busy
            ? "Loading your saved periods…"
            : "Refresh to load your saved periods."}
        </p>
      ) : insight.status === "empty" ? (
        <div className="progress-note">
          <h3>Start with one useful period</h3>
          <p>{insight.nextMeasurement}</p>
          <a href="#business-outcomes">Record a business period</a>
        </div>
      ) : (
        <>
          <div className="progress-selectors">
            <label htmlFor={`${id}-current`}>
              Current business period
              <select
                id={`${id}-current`}
                aria-label="Current business period"
                value={insight.current?.id ?? ""}
                onChange={(e) => {
                  setCurrentId(e.target.value);
                  setPreviousId("");
                }}
              >
                {insight.periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {progressPeriodLabel(p)} · {p.currency} ·{" "}
                    {p.source === "export"
                      ? "export-informed"
                      : "owner-entered"}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${id}-previous`}>
              Previous business period
              <select
                id={`${id}-previous`}
                aria-label="Previous business period"
                value={insight.previous?.id ?? ""}
                onChange={(e) => setPreviousId(e.target.value)}
              >
                <option value="">Closest earlier compatible period</option>
                {insight.periods
                  .filter((p) => p.id !== insight.current?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {progressPeriodLabel(p)} · {p.currency} ·{" "}
                      {p.source === "export"
                        ? "export-informed"
                        : "owner-entered"}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {insight.status === "invalid" ||
          insight.status === "noncomparable" ? (
            <div className="progress-note" role="note">
              <h3>These records are not compared</h3>
              <ul>
                {insight.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p>{insight.nextMeasurement}</p>
            </div>
          ) : insight.status === "single" ? (
            <div className="progress-note">
              <h3>One period is a starting point</h3>
              <p>{insight.nextMeasurement}</p>
            </div>
          ) : (
            <div className="progress-note">
              <strong>Like-for-like window definitions</strong>
              <p>
                {insight.comparison?.currentDays} current calendar days ·{" "}
                {insight.comparison?.previousDays} previous calendar days ·{" "}
                {insight.comparison?.gapDays === 0
                  ? "Adjacent periods"
                  : `${insight.comparison?.gapDays} unrecorded calendar days between these periods`}
                . {insight.comparison?.scopeNote}
              </p>
              <p className="fine-print">
                Different-length calendar months can vary with seasonality,
                working days and how long late-arriving inquiries or invoices
                have had to mature. A comparable definition does not remove
                those influences.
              </p>
            </div>
          )}
          {insight.current && (
            <div className="progress-periods">
              <PeriodFacts period={insight.current} title="Current period" />
              {insight.previous && (
                <PeriodFacts
                  period={insight.previous}
                  title="Previous period"
                />
              )}
            </div>
          )}
          {insight.metrics.length > 0 && (
            <div className="progress-metrics">
              {insight.metrics.map((metric) => (
                <article key={metric.id}>
                  <h3>{metric.label}</h3>
                  <p className="progress-value">
                    {value(
                      metric.id,
                      metric.current,
                      insight.current!.currency,
                    )}
                  </p>
                  <p className="fine-print">
                    Current:{" "}
                    {fraction(
                      metric.id,
                      metric.current,
                      insight.current!.currency,
                    )}
                  </p>
                  {metric.current.reason && <p>{metric.current.reason}</p>}
                  {metric.previous && (
                    <>
                      <p>
                        Previous:{" "}
                        {value(
                          metric.id,
                          metric.previous,
                          insight.previous!.currency,
                        )}
                      </p>
                      <p className="fine-print">
                        Previous:{" "}
                        {fraction(
                          metric.id,
                          metric.previous,
                          insight.previous!.currency,
                        )}
                      </p>
                      {metric.previous.reason && (
                        <p>{metric.previous.reason}</p>
                      )}
                    </>
                  )}
                  <p>
                    <strong>
                      {delta(
                        metric.id,
                        metric.delta,
                        insight.current!.currency,
                      )}
                    </strong>
                  </p>
                  <p className="fine-print">
                    {progressMetricDefinition(metric.id)}
                  </p>
                  <p className="fine-print">{metric.description}</p>
                </article>
              ))}
            </div>
          )}
          {history.length > 0 && insight.current && (
            <details className="progress-history">
              <summary>Comparable period history</summary>
              <p>
                Only periods with the selected source, currency, practice scope
                and window definition appear. Dates and gaps remain visible; no
                continuous trend, statistical significance or causal improvement
                is claimed. Showing the latest {history.length} of{" "}
                {insight.history.length} matching periods.
              </p>
              <div
                className="progress-table-scroll"
                role="region"
                aria-label="Comparable business period history"
                tabIndex={0}
              >
                <table>
                  <caption>
                    Recorded outcomes · {insight.current.currency} ·{" "}
                    {source(insight.current.source)}. Unknown values remain
                    unknown.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Period (UTC)</th>
                      <th scope="col">Days</th>
                      <th scope="col">Inquiry cohort</th>
                      <th scope="col">Inquiry → client</th>
                      <th scope="col">Spend / client</th>
                      <th scope="col">Invoice collection</th>
                      <th scope="col">Owner hours / day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((p) => {
                      const observations = progressObservations(p);
                      return (
                        <tr key={p.id}>
                          <th scope="row">
                            {p.startDate}
                            <br />
                            to {p.endDate}
                          </th>
                          <td>
                            {observations.owner_admin_hours_day.denominator}
                          </td>
                          <td>
                            {p.clients === null ? "?" : number(p.clients)}{" "}
                            clients /{" "}
                            {p.inquiries === null ? "?" : number(p.inquiries)}{" "}
                            inquiries
                          </td>
                          <td>
                            {value(
                              "inquiry_conversion",
                              observations.inquiry_conversion,
                              p.currency,
                            )}
                          </td>
                          <td>
                            {value(
                              "cost_per_client",
                              observations.cost_per_client,
                              p.currency,
                            )}
                            <span className="progress-cell-detail">
                              {fraction(
                                "cost_per_client",
                                observations.cost_per_client,
                                p.currency,
                              )}
                            </span>
                          </td>
                          <td>
                            {value(
                              "invoice_collection",
                              observations.invoice_collection,
                              p.currency,
                            )}
                            <span className="progress-cell-detail">
                              {fraction(
                                "invoice_collection",
                                observations.invoice_collection,
                                p.currency,
                              )}
                            </span>
                          </td>
                          <td>
                            {value(
                              "owner_admin_hours_day",
                              observations.owner_admin_hours_day,
                              p.currency,
                            )}
                            <span className="progress-cell-detail">
                              {fraction(
                                "owner_admin_hours_day",
                                observations.owner_admin_hours_day,
                                p.currency,
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
      <div className="progress-reassessments">
        <h3>Readiness reassessments</h3>
        <p>
          Readiness points describe your reported operating practices. They are
          not conversion percentages, legal quality or a prediction of business
          results.
        </p>
        {reassessment.reports.length === 0 ? (
          <p>Save a real assessment to start a private reassessment history.</p>
        ) : (
          <>
            <div className="progress-selectors">
              <label htmlFor={`${id}-current-report`}>
                Current readiness report
                <select
                  id={`${id}-current-report`}
                  aria-label="Current readiness report"
                  value={reassessment.current?.id ?? ""}
                  onChange={(e) => {
                    setCurrentReportId(e.target.value);
                    setPreviousReportId("");
                  }}
                >
                  {reassessment.reports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.snapshot.label} · {r.snapshot.createdAt.slice(0, 10)} ·{" "}
                      {r.snapshot.assessment.releaseId}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor={`${id}-previous-report`}>
                Previous readiness report
                <select
                  id={`${id}-previous-report`}
                  aria-label="Previous readiness report"
                  value={reassessment.previous?.id ?? ""}
                  onChange={(e) => setPreviousReportId(e.target.value)}
                >
                  <option value="">
                    Closest earlier report for this practice
                  </option>
                  {reassessment.reports
                    .filter((r) => r.id !== reassessment.current?.id)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.snapshot.label} · {r.snapshot.createdAt.slice(0, 10)}{" "}
                        · {r.snapshot.assessment.releaseId}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {reassessment.current && (
              <p className="fine-print">
                Current rubric{" "}
                {reassessment.current.snapshot.assessment.releaseId} ·{" "}
                {number(
                  reassessment.current.snapshot.assessment.coverage * 100,
                )}
                % evidence coverage · Assessed{" "}
                {stamp(reassessment.current.snapshot.createdAt)} · Saved{" "}
                {stamp(reassessment.current.savedAt)}.
                {reassessment.previous && (
                  <>
                    {" "}
                    Previous rubric{" "}
                    {reassessment.previous.snapshot.assessment.releaseId} ·{" "}
                    {number(
                      reassessment.previous.snapshot.assessment.coverage * 100,
                    )}
                    % evidence coverage · Assessed{" "}
                    {stamp(reassessment.previous.snapshot.createdAt)} · Saved{" "}
                    {stamp(reassessment.previous.savedAt)}.
                  </>
                )}
              </p>
            )}
            {comparison ? (
              comparison.comparable ? (
                <div className="progress-note">
                  <strong>
                    {comparison.delta! > 0 ? "+" : ""}
                    {number(comparison.delta!)} readiness points
                  </strong>
                  <p>
                    Same saved practice, declared context, rubric, applicable
                    questions and evidence coverage. The point difference
                    describes these two self-assessments; it does not
                    demonstrate an outcome change or verified improvement.
                  </p>
                  <ul>
                    {comparison.domains.map((d) => (
                      <li key={d.id}>
                        {d.label}:{" "}
                        {d.previous === null
                          ? "Outside scope"
                          : number(d.previous)}{" "}
                        →{" "}
                        {d.current === null
                          ? "Outside scope"
                          : number(d.current)}
                        {d.delta === null
                          ? ""
                          : ` (${d.delta > 0 ? "+" : ""}${number(d.delta)} points)`}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="progress-note">
                  <strong>Point change withheld</strong>
                  <ul>
                    {comparison.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <p>
                    For a like-for-like reassessment, use the same practice,
                    context and published rubric, answer the same applicable
                    questions, then compare the operating practices behind each
                    answer.
                  </p>
                </div>
              )
            ) : (
              <p>
                Save another assessment for this same practice when you want to
                revisit its operating practices. A different practice or rubric
                version will be labeled separately.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
