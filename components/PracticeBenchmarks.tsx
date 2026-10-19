"use client";
import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import {
  PRACTICE_BENCHMARK_GROUPS,
  PRACTICE_BENCHMARK_METRICS,
  type PracticeBenchmarkCohort,
  type PracticeBenchmarkMetric,
  type PracticeBenchmarkSummary,
} from "../lib/practice-benchmark-types";
import "./practice-benchmarks.css";
const stageLabels = {
  prelaunch: "Preparing to launch",
  new: "New practice",
  established: "Established practice",
};
const feeLabels = {
  hourly: "Hourly",
  flat: "Flat fee",
  contingency: "Contingency",
  subscription: "Subscription",
  mixed: "Mixed fees",
  other: "Other fee model",
};
function metricValue(id: PracticeBenchmarkMetric, value: number | null) {
  return value === null
    ? "Withheld"
    : id === "owner_admin_hours_day"
      ? `${value.toFixed(1)} hours / calendar day`
      : `${value.toFixed(0)}%`;
}
function CohortCard({ cohort }: { cohort: PracticeBenchmarkCohort }) {
  const label = PRACTICE_BENCHMARK_GROUPS.find(
    (g) => g.id === cohort.group,
  )?.label;
  return (
    <article className="practice-benchmark-cohort">
      <p className="practice-benchmark-kicker">
        Participant description · no percentile rank
      </p>
      <h4>
        {label} · {cohort.periodStart.slice(0, 7)}
      </h4>
      <dl className="practice-benchmark-scope">
        <div>
          <dt>Observation period</dt>
          <dd>
            {cohort.periodStart} to {cohort.periodEnd} · {cohort.calendarDays}{" "}
            calendar days
          </dd>
        </div>
        <div>
          <dt>Population</dt>
          <dd>
            {cohort.workspacesBand} eligible workspaces (approximate band)
          </dd>
        </div>
        <div>
          <dt>Practice stage / fees</dt>
          <dd>
            {stageLabels[cohort.stage]} · {feeLabels[cohort.feeModel]}
          </dd>
        </div>
        <div>
          <dt>Figures</dt>
          <dd>
            {cohort.currency} ·{" "}
            {cohort.source === "export"
              ? "Export-informed owner reports"
              : "Owner-entered figures"}
          </dd>
        </div>
        <div>
          <dt>Baseline timing</dt>
          <dd>
            {cohort.provenance === "preregistered"
              ? "Registered before the month began"
              : "Retrospective link to a pre-existing baseline"}
          </dd>
        </div>
        <div>
          <dt>Scoring / mapping</dt>
          <dd>
            {cohort.releaseId} · {cohort.mappingVersion}
          </dd>
        </div>
      </dl>
      <p className="practice-benchmark-score">
        Median baseline readiness:{" "}
        <strong>{cohort.medianReadinessScore} rubric points out of 100</strong>.
        Rounded to five points; this is a readiness measure.
      </p>
      <div className="practice-benchmark-metrics">
        {cohort.metrics.map((metric) => {
          const definition = PRACTICE_BENCHMARK_METRICS.find(
            (d) => d.id === metric.id,
          )!;
          return (
            <section key={metric.id} className="practice-benchmark-metric">
              <h5>{definition.label}</h5>
              <p className="practice-benchmark-value">
                {metricValue(metric.id, metric.median)}
              </p>
              <p>
                {metric.status === "descriptive"
                  ? `Median of ${metric.knownWorkspacesBand} workspaces with known values (approximate band; at least 30).`
                  : "Fewer than 30 known workspace values. Unknown or undefined ratios are excluded; no zero is substituted."}
              </p>
              <dl>
                <div>
                  <dt>Numerator, per workspace</dt>
                  <dd>{definition.numerator}</dd>
                </div>
                <div>
                  <dt>Denominator, per workspace</dt>
                  <dd>{definition.denominator}</dd>
                </div>
              </dl>
              <p className="practice-benchmark-note">{definition.limitation}</p>
              {metric.scoreBands.length ? (
                <details>
                  <summary>See descriptive readiness bands</summary>
                  <div className="practice-benchmark-table-wrap">
                    <table>
                      <caption>
                        Same scope, grouped by baseline readiness. Every cell
                        has at least five known workspaces. No causal or
                        predictive claim.
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Readiness points</th>
                          <th scope="col">Known workspaces</th>
                          <th scope="col">Median outcome</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metric.scoreBands.map((cell) => (
                          <tr key={cell.scoreBand}>
                            <th scope="row">{cell.scoreBand}</th>
                            <td>{cell.knownWorkspacesBand} (approx.)</td>
                            <td>{metricValue(metric.id, cell.median)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : (
                <p className="practice-benchmark-note">
                  Readiness-band details withheld unless every cell has at least
                  five known workspaces and the metric has at least 30.
                </p>
              )}
            </section>
          );
        })}
      </div>
    </article>
  );
}
export default function PracticeBenchmarks() {
  const headingId = useId();
  const [data, setData] = useState<PracticeBenchmarkSummary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [group, setGroup] = useState("all");
  const [cohortId, setCohortId] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/practice-benchmarks", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const value: PracticeBenchmarkSummary = await response.json();
        if (
          !["forming", "descriptive", "unavailable"].includes(value.status) ||
          !Array.isArray(value.cohorts) ||
          !Array.isArray(value.limitations)
        )
          throw new Error("unavailable");
        if (!controller.signal.aborted) {
          setData(value);
          setLoadError(false);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setData(null);
          setLoadError(true);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [refresh]);
  const cohorts = useMemo(
    () =>
      data?.cohorts.filter((c) => group === "all" || c.group === group) ?? [],
    [data, group],
  );
  const selected = cohorts.find((c) => c.id === cohortId) ?? cohorts[0] ?? null;
  const changeGroup = (value: string) => {
    setGroup(value);
    setCohortId("");
  };
  return (
    <section className="practice-benchmarks" aria-labelledby={headingId}>
      <div className="practice-benchmark-heading">
        <div>
          <p className="practice-benchmark-kicker">
            First-party research · separate from industry references
          </p>
          <h2 id={headingId}>Compare a practice like yours</h2>
          <p>
            Choose a standardized practice area, then inspect the exact scope.
            We publish participant medians only when enough comparable evidence
            exists.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          disabled={loading}
          onClick={() => {
            setData(null);
            setLoading(true);
            setRefresh((n) => n + 1);
          }}
        >
          Refresh practice comparisons
        </button>
      </div>
      <div className="practice-benchmark-controls">
        <label>
          Standardized practice area
          <select
            aria-label="Benchmark practice area"
            value={group}
            onChange={(event) => changeGroup(event.target.value)}
          >
            <option value="all">All standardized areas</option>
            {PRACTICE_BENCHMARK_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
            <option value="unclassified">Other / unspecified / custom</option>
          </select>
        </label>
        {cohorts.length > 1 ? (
          <label>
            Published comparison scope
            <select
              aria-label="Published practice comparison scope"
              value={selected?.id ?? ""}
              onChange={(event) => setCohortId(event.target.value)}
            >
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {
                    PRACTICE_BENCHMARK_GROUPS.find((g) => g.id === c.group)
                      ?.label
                  }{" "}
                  · {c.periodStart.slice(0, 7)} · {stageLabels[c.stage]} ·{" "}
                  {feeLabels[c.feeModel]} · {c.currency} ·{" "}
                  {c.source === "export" ? "Export-informed" : "Owner-entered"}{" "}
                  ·{" "}
                  {c.provenance === "preregistered"
                    ? "Registered"
                    : "Retrospective"}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div
        role="status"
        aria-live="polite"
        className="practice-benchmark-status"
      >
        {loading ? (
          <p>Checking the complete comparable dataset…</p>
        ) : loadError ? (
          <p>
            Practice comparisons are temporarily unavailable. No statistic is
            shown; try refreshing later.
          </p>
        ) : group === "unclassified" ? (
          <>
            <h3>Unclassified areas stay private</h3>
            <p>
              “Other,” blank answers and custom wording do not enter a published
              practice group. We do not infer a specialization or pool these
              answers into an “Other” benchmark.
            </p>
          </>
        ) : selected ? (
          <p>{data?.explanation}</p>
        ) : (
          <>
            <h3>
              {data?.status === "unavailable"
                ? data.title
                : !data?.mappingSupported
                  ? data?.title
                  : "This practice comparison is still forming"}
            </h3>
            <p>
              {data?.status === "descriptive"
                ? "No published scope is ready for this selected practice area. Each metric still needs at least 30 known workspaces in the same calendar month and comparison scope; results from another area are not substituted."
                : data?.explanation}
            </p>
            <p>
              A missing peer median means evidence is insufficient or
              unavailable. It does not mean a weak practice or a score of zero.
            </p>
          </>
        )}
      </div>
      {selected && !loading && !loadError && group !== "unclassified" ? (
        <CohortCard cohort={selected} />
      ) : null}
      <p className="practice-benchmark-note">
        Jurisdictions and firm sizes are not matched. Currency does not identify
        a legal market. Export-informed figures remain owner reports. These
        benchmarks do not certify legal skill or change your grade.
      </p>
      {!selected && !loading ? (
        <div className="practice-benchmark-next">
          <h3>Make the next comparison more useful</h3>
          <ol>
            <li>
              Save a fresh assessment with your actual primary practice area.
            </li>
            <li>
              Register a future calendar month, then record aggregate inquiry,
              invoice and owner-time totals after it closes.
            </li>
            <li>
              Research participation is optional. Both assessment benchmarking
              and outcome research must be enabled for a contribution; tracking
              and private insights work without them.
            </li>
          </ol>
          <Link href="/account" className="btn btn-primary">
            Track my practice privately
          </Link>
        </div>
      ) : null}
      <details className="practice-benchmark-method">
        <summary>Population, privacy and interpretation</summary>
        {data?.limitations.map((limitation) => (
          <p key={limitation}>{limitation}</p>
        )) ?? (
          <p>
            At least 30 known distinct workspace values per metric are needed in
            a fixed compatible group. Custom practice wording is excluded, and
            partial source reads never publish a statistic.
          </p>
        )}
        <p>
          Only privacy-checked published scopes appear in the selector; it does
          not query arbitrary data slices. Full calendar months and registered /
          retrospective tracks remain separate. No compatible practice-specific
          numbers are fabricated from broad industry surveys.
        </p>
        <p>
          Industry references elsewhere on this page keep their own source,
          survey population and dates. They are editorial context and do not
          fill gaps in this first-party sample.
        </p>
        {data ? (
          <p>
            Method: {data.methodologyVersion} · Mapping policy:{" "}
            {data.mappingVersion} · Scoring release:{" "}
            {data.releaseId ?? "unavailable"}. Dataset checked{" "}
            {new Date(data.generatedAt).toLocaleString()}. Sample observation
            dates appear on each published scope.
          </p>
        ) : null}
      </details>
    </section>
  );
}
