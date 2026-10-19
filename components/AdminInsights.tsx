"use client";
import { useEffect, useState } from "react";
import {
  HELP_STATUSES,
  HELP_TOPIC_LABELS,
  type HelpStatus,
} from "../lib/help-requests";
import type { researchSummary } from "../lib/research";
import type { AdminHelpRequest } from "../lib/server/research-store";
import { AdminNurture } from "./NurtureEnrollment";
import AdminCalibration from "./AdminCalibration";
import AdminLeadRouting from "./AdminLeadRouting";
import "./published-admin.css";

interface Insights {
  research: ReturnType<typeof researchSummary>;
  activeReleaseId: string;
  counts: {
    workspaces: number;
    benchmarkingConsent: number;
    marketingConsent: number;
    helpRequestsByStatus: Partial<Record<HelpStatus, number>>;
  };
  requests: AdminHelpRequest[];
}
export default function AdminInsights() {
  const [data, setData] = useState<Insights | null>(null);
  const [access, setAccess] = useState<
    "loading" | "allowed" | "sign_in" | "forbidden" | "error"
  >("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<
    Record<string, { status: HelpStatus; reason: string }>
  >({});
  async function load() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/insights", {
        cache: "no-store",
      });
      if (response.status === 401) {
        setAccess("sign_in");
        return;
      }
      if (response.status === 403) {
        setAccess("forbidden");
        return;
      }
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Insights could not be loaded.");
      setData(body as Insights);
      setAccess("allowed");
      setEdits({});
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Insights could not be loaded.",
      );
      setAccess("error");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function update(request: AdminHelpRequest) {
    const edit = edits[request.id];
    if (!edit || edit.reason.trim().length < 10) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/leads/${request.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: edit.status,
          reason: edit.reason,
          revision: request.revision,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "The request could not be updated.");
      await load();
      setMessage("Request status saved.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The request could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="published-admin">
      <header className="pa-heading">
        <div>
          <p className="pa-eyebrow">PEARL PRACTICE GRADER</p>
          <h1>Learning and requested help</h1>
          <p>
            Permissioned research and a minimal commercial handoff, kept
            separate from the practice grade.
          </p>
        </div>
        <a href="/admin">Methodology administration</a>
      </header>
      {access === "loading" && (
        <p role="status">Checking administrator access…</p>
      )}
      {access === "sign_in" && (
        <section className="pa-card">
          <h2>Sign in to continue</h2>
          <p>A verified administrator account is required.</p>
          <a href="/account?next=/admin/insights">Open account sign-in</a>
        </section>
      )}
      {access === "forbidden" && (
        <section className="pa-card">
          <h2>Administrator access required</h2>
          <p>
            This account cannot access research exports or requested-help
            records.
          </p>
        </section>
      )}
      {access === "error" && (
        <section className="pa-card">
          <p role="alert">{message}</p>
          <button disabled={busy} onClick={() => void load()}>
            Try again
          </button>
        </section>
      )}
      {access === "allowed" && data && (
        <>
          <section className="pa-card">
            <h2>Benchmarks and public recognition</h2>
            <p>
              Published industry observations keep their own source and cohort.
              Community aggregates and anonymous entries use separate consent
              and minimum group sizes. None changes the issued practice grade.
            </p>
            <div className="pa-actions">
              <a href="/benchmarks">View benchmarks</a>
              <a href="/leaderboard">View the opt-in leaderboard</a>
            </div>
          </section>
          <AdminNurture />
          <AdminCalibration />
          <AdminLeadRouting />
          <section className="pa-card pa-summary">
            <div>
              <strong>Private workspaces</strong>
              <p>{data.counts.workspaces}</p>
              <small>Accounts are not verified distinct law firms.</small>
            </div>
            <div>
              <strong>Benchmarking permission</strong>
              <p>{data.counts.benchmarkingConsent}</p>
              <small>
                Eligible current observations:{" "}
                {data.research.eligibleWorkspaces}
              </small>
            </div>
            <div>
              <strong>Grader email permission</strong>
              <p>{data.counts.marketingConsent}</p>
              <small>
                Course-only permission is excluded from the general marketing
                export. Permission never adds practice-grade points.
              </small>
            </div>
          </section>
          <section className="pa-card">
            <h2>Research quality and coverage</h2>
            <p>{data.research.limitations}</p>
            <p>
              Use the latest eligible assessment per consenting workspace, the
              same approved scoring release, at least 80% applicable evidence,
              and an assessment no older than {data.research.freshnessDays}{" "}
              days. Scores are reproduced from saved observations.
            </p>
            <p>
              <strong>Current release:</strong>{" "}
              <code>{data.activeReleaseId}</code>
            </p>
            {data.research.truncated && (
              <p role="alert">
                The current export limit was reached. Descriptive statistics are
                suppressed until a complete extract is reviewed.
              </p>
            )}
            {data.research.overall.status === "suppressed" ? (
              <p className="pa-note">
                Performance statistics are suppressed. A descriptive cohort
                needs at least {data.research.minimumCohort} distinct eligible
                workspaces, plus review of its source quality. This is not a
                public peer benchmark.
              </p>
            ) : (
              <div className="pa-table">
                <table>
                  <thead>
                    <tr>
                      <th>Operating area</th>
                      <th>Eligible workspace observations</th>
                      <th>Owner-reported median</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.research.overall.domains.map((domain) => (
                      <tr key={domain.id}>
                        <th>{domain.id}</th>
                        <td>{domain.workspaces}</td>
                        <td>
                          {domain.median ??
                            "Suppressed: insufficient observations"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pa-buttons">
              <a href="/api/admin/research/export">
                Download pseudonymized research CSV
              </a>
              <a href="/api/admin/research/export?format=json">
                Download research JSON and policy notes
              </a>
            </div>
            <p className="pa-note">
              Exports omit email, website URLs, locations, raw answers and
              essential-control findings. They contain rounded assessment months
              and explicitly owner-reported outcomes. Withdrawal excludes the
              workspace from future extracts. Each download records its purpose
              and row count.
            </p>
          </section>
          <section className="pa-card">
            <h2>Requested-help pipeline</h2>
            <p>
              These account owners explicitly asked Pearl to contact them about
              a selected business need. Recording a request does not send a
              notification, email or CRM update.
            </p>
            <div className="pa-buttons">
              {HELP_STATUSES.map((status) => (
                <span key={status}>
                  {status.replaceAll("_", " ")}:{" "}
                  {data.counts.helpRequestsByStatus[status] ?? 0}
                </span>
              ))}
            </div>
            <p>
              <a href="/api/admin/leads/export?purpose=requested_help">
                Download open requested-help handoff
              </a>
            </p>
            <p className="pa-note">
              The handoff contains only verified email, selected need, status
              and the purpose/date of permission. Closed, withdrawn, stale and
              already-contacted requests are excluded from this handoff.
              Follow-up still requires an authorized human process or a
              separately configured integration.
            </p>
            {data.requests.length === 0 ? (
              <p>No help requests have been recorded.</p>
            ) : (
              data.requests.map((request) => {
                const edit = edits[request.id] ?? {
                  status: request.status,
                  reason: "",
                };
                return (
                  <article className="pa-question" key={request.id}>
                    <strong>{HELP_TOPIC_LABELS[request.topic]}</strong>
                    <p>
                      {request.contactConsent
                        ? "Verified contact details appear only in an authorized handoff export."
                        : "Contact permission withdrawn."}
                    </p>
                    <p className="pa-note">
                      Requested{" "}
                      {new Date(request.createdAt).toLocaleDateString()} ·{" "}
                      {request.status.replaceAll("_", " ")}
                    </p>
                    <details>
                      <summary>Purpose of permission</summary>
                      <p>{request.consentText}</p>
                      <small>{request.consentVersion}</small>
                    </details>
                    <div className="pa-fields">
                      <label>
                        Status
                        <select
                          disabled={busy || !request.contactConsent}
                          value={edit.status}
                          onChange={(event) =>
                            setEdits((previous) => ({
                              ...previous,
                              [request.id]: {
                                ...edit,
                                status: event.target.value as HelpStatus,
                              },
                            }))
                          }
                        >
                          {HELP_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Reason for status change
                        <input
                          disabled={busy || !request.contactConsent}
                          value={edit.reason}
                          maxLength={500}
                          onChange={(event) =>
                            setEdits((previous) => ({
                              ...previous,
                              [request.id]: {
                                ...edit,
                                reason: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                    </div>
                    <button
                      disabled={
                        busy ||
                        !request.contactConsent ||
                        edit.status === request.status ||
                        edit.reason.trim().length < 10
                      }
                      onClick={() => void update(request)}
                    >
                      Save status
                    </button>
                  </article>
                );
              })
            )}
          </section>
          <section className="pa-card">
            <h2>Separate marketing handoff</h2>
            <p>
              Only accounts with an active, optional marketing preference appear
              in this export. A request for help does not enroll anyone in
              marketing.
            </p>
            <a href="/api/admin/leads/export?purpose=marketing">
              Download current marketing opt-ins
            </a>
            <p className="pa-note">
              This download performs no outreach and does not create contacts or
              deals in an external CRM.
            </p>
          </section>
          <button disabled={busy} onClick={() => void load()}>
            Refresh consent and request status
          </button>
          {message && <p role="status">{message}</p>}
        </>
      )}
    </main>
  );
}
