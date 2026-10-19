"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { DOMAIN_IDS } from "../lib/types";
import type {
  CalibrationMetric,
  CalibrationSummary,
  CalibrationWeights,
} from "../lib/calibration";
import "./admin-calibration.css";

const labels = {
  presence: "Public presence",
  intake: "Intake & opportunity",
  service: "Client experience",
  cash: "Pricing & cash",
  operations: "Practice operations",
  independence: "Owner independence",
};
const qualityLabels: Record<string, string> = {
  no_consent: "Permission withdrawn during analysis",
  invalid_record: "Invalid or inconsistent source",
  no_baseline: "No linked baseline",
  baseline_after_start: "Baseline assessed or saved after period start",
  stale_baseline: "Baseline older than 90 days at start",
  incomparable_period: "Outside the fixed 28–31-day monthly window",
  different_release: "Different scoring release",
  insufficient_evidence: "Insufficient baseline evidence",
  no_closed_period: "No recent closed outcome period",
};
const metricValue = (id: CalibrationMetric, value: number | null) =>
  value === null
    ? "Unavailable"
    : id === "owner_admin_hours_day"
      ? `${value.toFixed(1)} hours/day`
      : `${(value * 100).toFixed(1)}%`;
const association = (value: number | null) =>
  value === null ? "Undefined / unavailable" : value.toFixed(2);

export default function AdminCalibration() {
  const id = useId();
  const [data, setData] = useState<CalibrationSummary | null>(null);
  const [weights, setWeights] = useState<CalibrationWeights | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/calibration", {
          cache: "no-store",
        }),
        result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Calibration evidence could not load.");
      setData(result);
      setWeights(result.currentWeights);
      setMessage("");
    } catch (error) {
      setData(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Calibration evidence could not load.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function compare() {
    if (!data || !weights) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/calibration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedReleaseId: data.releaseId, weights }),
        }),
        result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "The candidate could not be compared.");
      setData(result);
      setMessage(
        "Exploratory comparison only. No scoring release, issued grade, or business record was changed.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The candidate could not be compared.",
      );
    } finally {
      setBusy(false);
    }
  }
  const visible =
    data?.cohorts.filter(
      (c) =>
        c.workspaces !== null ||
        c.metrics.some((m) => m.status === "descriptive"),
    ) ?? [];
  const experimentReady =
    data?.cohorts.some((c) =>
      c.metrics.some((m) => m.candidate.status !== "forming"),
    ) ?? false;
  return (
    <section className="admin-calibration" aria-labelledby={`${id}-title`}>
      <p className="eyebrow">LEARNING FROM OUTCOMES · OPERATOR ONLY</p>
      <div className="calibration-heading">
        <h2 id={`${id}-title`}>Does readiness line up with later results?</h2>
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? "Checking…" : "Refresh evidence"}
        </button>
      </div>
      <p>
        Evaluate the rubric against later business observations with explicit
        permission and a baseline saved before the period began. Research can
        inform a reviewed future release; it never rewrites issued grades.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {data ? (
        <>
          <div className="calibration-note">
            <strong>
              {data.status === "descriptive"
                ? "Exploratory evidence"
                : data.status === "incomplete"
                  ? "Analysis withheld"
                  : "Evidence is still forming"}
            </strong>
            <p>{data.explanation}</p>
            <p className="fine-print">
              {data.releaseLabel} · {data.methodologyVersion} · Eligible
              workspace band:{" "}
              {data.eligibleWorkspaces ?? "not published below 30"}. Consented
              source workspaces before eligibility:{" "}
              {data.sourceWorkspaces ?? "not published below 30"}.
            </p>
          </div>
          <div className="calibration-fixed-metrics">
            {data.evidenceTracks?.map((track) => (
              <div key={track.provenance}>
                <strong>
                  {track.provenance === "preregistered"
                    ? "Registered before the period"
                    : "Retrospective baseline links"}
                </strong>
                <p>
                  {track.status === "descriptive"
                    ? "Exploratory descriptions available"
                    : "Evidence still forming"}{" "}
                  · {track.eligibleWorkspaces ?? "Count suppressed below 30"}.
                  These tracks are never pooled.
                </p>
              </div>
            ))}
          </div>
          <div className="calibration-fixed-metrics">
            <div>
              <strong>Inquiry → client</strong>
              <p>
                Retained clients / inquiries first received in the period,
                followed through that period’s end.
              </p>
            </div>
            <div>
              <strong>Billed → collected</strong>
              <p>
                Collected amount / invoices issued in the period, counting only
                collections on those invoices by period end.
              </p>
            </div>
            <div>
              <strong>Owner administration</strong>
              <p>
                Your own administration hours / calendar days in the closed
                period.
              </p>
            </div>
          </div>
          {visible.length === 0 ? (
            <p className="calibration-empty">
              No fixed currency/source/stage/fee group has 30 eligible monthly
              observations yet. The collection process is ready; the evidence
              has not reached the analysis threshold.
            </p>
          ) : (
            visible.map((cohort) => (
              <article
                key={`${cohort.provenance}-${cohort.currency}-${cohort.source}-${cohort.stage}-${cohort.feeModel}`}
                className="calibration-cohort"
              >
                <h3>
                  {cohort.provenanceLabel} · {cohort.currency} · {cohort.stage}{" "}
                  · {cohort.feeModel} fees · {cohort.sourceLabel}
                </h3>
                <p className="fine-print">
                  {cohort.workspaces ?? "Suppressed"} independent workspaces,
                  one eligible monthly period each. Different registration
                  track, currency, source, practice stage and fee-model groups
                  are not pooled.
                </p>
                {cohort.metrics.map((metric) => (
                  <div key={metric.id} className="calibration-metric">
                    <h4>{metric.label}</h4>
                    <p>
                      {metric.unit}. {metric.direction}.
                    </p>
                    {metric.status === "forming" ? (
                      <p className="fine-print">
                        Fewer than 30 known workspaces. Missing or
                        zero-denominator observations remain unknown.
                      </p>
                    ) : (
                      <>
                        <p>
                          <strong>
                            Median:{" "}
                            {metricValue(metric.id, metric.medianOutcome)}
                          </strong>{" "}
                          · {metric.knownWorkspaces} known workspaces · Rank
                          association: {association(metric.rankAssociation)}
                        </p>
                        <p className="fine-print">
                          Missing observations:{" "}
                          {metric.missingWorkspaces ?? "suppressed or none"}.
                          Association is not conversion uplift, model accuracy,
                          or causation.
                        </p>
                        <div className="calibration-table-wrap">
                          <table>
                            <caption>
                              Median outcome within prespecified baseline
                              readiness bands
                            </caption>
                            <thead>
                              <tr>
                                <th>Readiness score</th>
                                <th>Workspaces</th>
                                <th>Median later outcome</th>
                              </tr>
                            </thead>
                            <tbody>
                              {metric.scoreBands.map((band) => (
                                <tr key={band.scoreBand}>
                                  <td>{band.scoreBand} points</td>
                                  <td>{band.workspaces ?? "Below5 or none"}</td>
                                  <td>
                                    {metricValue(metric.id, band.medianOutcome)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    {metric.candidate.status !== "forming" && (
                      <div className="calibration-table-wrap">
                        <table>
                          <caption>
                            Exploratory candidate comparison · Spearman rank
                            association
                          </caption>
                          <thead>
                            <tr>
                              <th>Workspace split</th>
                              <th>Count band</th>
                              <th>Current rubric</th>
                              <th>Candidate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(["train", "test"] as const).map((split) => (
                              <tr key={split}>
                                <td>
                                  {split === "train"
                                    ? "Development"
                                    : "Held-out comparison"}
                                </td>
                                <td>{metric.candidate[split]?.workspaces}</td>
                                <td>
                                  {association(
                                    metric.candidate[split]
                                      ?.currentAssociation ?? null,
                                  )}
                                </td>
                                <td>
                                  {data.candidateWeights
                                    ? association(
                                        metric.candidate[split]
                                          ?.candidateAssociation ?? null,
                                      )
                                    : "Enter candidate weights"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </article>
            ))
          )}
          {data.dataQuality.length > 0 && (
            <details>
              <summary>Eligibility and data quality</summary>
              <p className="fine-print">
                Only workspaces granting both research permissions with at least
                one saved period enter this source read. Counts below 5 are
                suppressed; repeated periods never increase workspace counts.
              </p>
              <dl className="calibration-quality">
                {data.dataQuality.map((item) => (
                  <div key={item.reason}>
                    <dt>{qualityLabels[item.reason] ?? item.reason}</dt>
                    <dd>{item.workspaces ?? "Suppressed or none"}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <div className="calibration-candidate">
            <h3>Try module weights without publishing</h3>
            <p>
              Weights are held in memory for this comparison. Nothing is fitted
              or automatically activated. Each metric needs at least 100
              distinct pairs, including 70 development and 30 held-out
              workspaces. Repeatedly inspecting the same holdout makes the
              comparison exploratory.
            </p>
            {data.candidateWeights && (
              <p className="fine-print">
                Last compared candidate:{" "}
                {DOMAIN_IDS.map(
                  (domain) =>
                    `${labels[domain]} ${data.candidateWeights![domain]}`,
                ).join(" · ")}
                .{" "}
                {weights &&
                DOMAIN_IDS.some(
                  (domain) =>
                    weights[domain] !== data.candidateWeights![domain],
                )
                  ? "Your draft differs; the tables still show that last compared candidate."
                  : "The tables show these candidate weights."}
              </p>
            )}
            {weights && (
              <div className="calibration-weight-grid">
                {DOMAIN_IDS.map((domain) => (
                  <label key={domain} htmlFor={`${id}-${domain}`}>
                    <span>{labels[domain]}</span>
                    <input
                      id={`${id}-${domain}`}
                      type="number"
                      min="0.1"
                      max="100"
                      step="0.1"
                      value={weights[domain]}
                      onChange={(event) =>
                        setWeights((previous) =>
                          previous
                            ? {
                                ...previous,
                                [domain]: Number(event.target.value),
                              }
                            : previous,
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            )}
            <button
              className="btn btn-secondary"
              disabled={
                busy ||
                !experimentReady ||
                !weights ||
                Object.values(weights).some(
                  (n) => !Number.isFinite(n) || n < 0.1 || n > 100,
                )
              }
              onClick={() => void compare()}
            >
              Compare candidate in memory
            </button>
            {!experimentReady && (
              <p className="fine-print">
                Candidate comparison is unavailable until the independent
                workspace thresholds are met.
              </p>
            )}
            <p className="fine-print">
              A promising pattern still requires prospective validation, review
              of missingness and practice mix, and the existing release
              publication controls. No automatic winner or “validated” badge is
              assigned.
            </p>
          </div>
          <details>
            <summary>Methodology, consent and limits</summary>
            <ul>
              {data.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="fine-print">
              Pilot source limit: 200 workspaces; a truncated read suppresses
              all analysis.
            </p>
            <div className="calibration-method-links">
              {data.methodsSources.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.title}
                </a>
              ))}
            </div>
          </details>
        </>
      ) : (
        <p>
          {busy
            ? "Checking calibration evidence…"
            : "Evidence is unavailable. Current grades remain unchanged."}
        </p>
      )}
    </section>
  );
}
