"use client";
import { useCallback, useEffect, useState } from "react";
import {
  HELP_STATUSES,
  HELP_TOPIC_LABELS,
  type HelpStatus,
} from "../lib/help-requests";
import type { RequestedContactDetail } from "../lib/lead-routing";
import type { RequestedContactQueueItem } from "../lib/server/lead-routing-store";
import "./admin-lead-routing.css";
interface Queue {
  requests: RequestedContactQueueItem[];
  truncated: boolean;
  scope: string;
}
export default function AdminLeadRouting() {
  const [data, setData] = useState<Queue | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState<RequestedContactDetail | null>(null);
  const [edits, setEdits] = useState<
    Record<string, { status: HelpStatus; reason: string }>
  >({});
  const load = useCallback(async () => {
    setDetail(null);
    setBusy(true);
    try {
      const response = await fetch("/api/admin/routing", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "The requested-contact queue could not load.",
        );
      setData(result);
      setEdits({});
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The queue could not load.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!detail) return;
    const timer = setTimeout(() => setDetail(null), 60000);
    return () => clearTimeout(timer);
  }, [detail]);
  async function view(request: RequestedContactQueueItem) {
    setDetail(null);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/routing/${request.id}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: "VIEW REQUESTED CONTACT",
          revision: request.revision,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error ||
            "Permission changed. Refresh before viewing contact details.",
        );
      setDetail(result.detail);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Contact details are unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function update(request: RequestedContactQueueItem) {
    const edit = edits[request.id];
    if (!edit || edit.reason.trim().length < 10) return;
    setDetail(null);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/leads/${request.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: edit.status,
          revision: request.revision,
          reason: edit.reason.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "The request changed. Refresh before updating it.",
        );
      await load();
      setMessage("Request status saved. No message was sent.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The request could not update.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="lead-routing"
      className="requested-contact-admin"
      aria-labelledby="requested-contact-heading"
    >
      <header>
        <p className="eyebrow">PURPOSE-BOUND PRIVATE FOLLOW-UP</p>
        <h2 id="requested-contact-heading">People who asked Pearl for help</h2>
        <p>
          This queue includes only new requests that separately authorize the
          selected need and optional report summary. Marketing, research and
          lesson subscriptions do not authorize contact. No external CRM
          connection or automatic messages are active.
        </p>
        <button
          className="btn btn-secondary"
          onClick={() => {
            setMessage("");
            void load();
          }}
          disabled={busy}
        >
          Refresh contact queue
        </button>
      </header>
      {message && <p role="status">{message}</p>}
      {!data ? (
        <p>Loading requested contact…</p>
      ) : data.requests.length === 0 ? (
        <p>
          No requests with this new contact permission yet. Earlier requests
          retain their original scope in the existing request history.
        </p>
      ) : (
        <>
          {data.truncated && (
            <p>
              Showing the100 newest requests. Older requests remain in request
              history.
            </p>
          )}
          <div className="requested-contact-list">
            {data.requests.map((request) => {
              const edit = edits[request.id] ?? {
                status: request.status,
                reason: "",
              };
              return (
                <article className="requested-contact-card" key={request.id}>
                  <header>
                    <h3>{HELP_TOPIC_LABELS[request.topic]}</h3>
                    <span>
                      {request.status.replaceAll("_", " ")} ·{" "}
                      {new Date(request.createdAt).toLocaleDateString()}
                    </span>
                  </header>
                  <p>
                    {request.hasSelectedReport
                      ? "The owner selected a readiness summary for this request."
                      : "No report was selected for sharing."}{" "}
                    {request.canViewContact
                      ? "Contact permission is checked again when you view details."
                      : "Contact details are unavailable because this request is withdrawn, finished or older than90 days."}
                  </p>
                  <button
                    className="btn btn-secondary"
                    disabled={busy || !request.canViewContact}
                    onClick={() => void view(request)}
                  >
                    View contact details
                  </button>
                  {detail?.requestId === request.id && (
                    <div
                      className="requested-contact-detail"
                      role="region"
                      aria-label="Purpose-bound contact details"
                    >
                      <p>
                        <strong>Verified account email:</strong>{" "}
                        <a href={`mailto:${detail.verifiedEmail}`}>
                          {detail.verifiedEmail}
                        </a>
                      </p>
                      <p>{detail.emailVerificationNote}</p>
                      {detail.reportSummary ? (
                        <p>
                          Selected owner-reported readiness summary:{" "}
                          {detail.reportSummary.score === null
                            ? "score withheld"
                            : `${detail.reportSummary.score}/100`}
                          ; {detail.reportSummary.coveragePercent}% evidence
                          coverage; rubric {detail.reportSummary.rubricVersion}.
                          This does not measure legal quality.
                        </p>
                      ) : (
                        <p>
                          No report summary is available. Private answers,
                          outcomes, websites and client details are excluded.
                        </p>
                      )}
                      <details>
                        <summary>Contact permission used</summary>
                        <p>{detail.consentText}</p>
                      </details>
                      <p className="fine-print">
                        This view is audited and hides after one minute. Recheck
                        current permission before contacting. No email has been
                        sent by viewing it.
                      </p>
                      <button
                        className="quiet-button"
                        onClick={() => setDetail(null)}
                      >
                        Hide contact details
                      </button>
                    </div>
                  )}
                  <div className="requested-contact-edit">
                    <label className="field-label">
                      Request status
                      <select
                        aria-label="Request status"
                        value={edit.status}
                        disabled={busy || !request.contactConsent}
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
                    <label className="field-label">
                      Reason for this change
                      <input
                        type="text"
                        maxLength={500}
                        value={edit.reason}
                        disabled={busy || !request.contactConsent}
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
                    <button
                      className="btn btn-primary"
                      disabled={
                        busy ||
                        !request.contactConsent ||
                        edit.reason.trim().length < 10 ||
                        edit.status === request.status
                      }
                      onClick={() => void update(request)}
                    >
                      Save request status
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
