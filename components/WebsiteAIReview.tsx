"use client";

import { useState } from "react";
import { BookOpen, ChevronDown, RefreshCw } from "lucide-react";
import {
  AI_REVIEW_CONSENT_TEXT,
  isWebsiteAIReview,
  type AIReviewAvailability,
} from "../lib/ai-review";

const states = [
  "disabled",
  "ineligible",
  "ready",
  "pending",
  "complete",
  "unavailable",
];
function availability(value: unknown): AIReviewAvailability | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.enabled !== "boolean" ||
    typeof item.eligible !== "boolean" ||
    typeof item.state !== "string" ||
    !states.includes(item.state) ||
    typeof item.reason !== "string" ||
    item.reason.length > 1000 ||
    typeof item.sourceCount !== "number" ||
    !Number.isInteger(item.sourceCount) ||
    item.sourceCount < 0 ||
    item.sourceCount > 24 ||
    !(
      item.scanDate === null ||
      (typeof item.scanDate === "string" &&
        Number.isFinite(Date.parse(item.scanDate)))
    ) ||
    typeof item.cached !== "boolean" ||
    !(item.review === null || isWebsiteAIReview(item.review)) ||
    (item.state === "complete" && item.review === null)
  )
    return null;
  return item as unknown as AIReviewAvailability;
}

export default function WebsiteAIReview({ reportId }: { reportId: string }) {
  const [state, setState] = useState<AIReviewAvailability | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load(generate = false) {
    if (generate && (!consent || !state?.enabled || !state.eligible)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/account/reports/${encodeURIComponent(reportId)}/ai`,
        {
          method: generate ? "POST" : "GET",
          credentials: "same-origin",
          cache: "no-store",
          ...(generate
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ consent: true }),
              }
            : {}),
          signal: AbortSignal.timeout(generate ? 75_000 : 20_000),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error.slice(0, 500)
            : "The explanation is unavailable. Your saved report and grades are unchanged.";
        throw new Error(message);
      }
      const next = availability(body);
      if (!next)
        throw new Error(
          "The explanation could not be verified against its stored excerpts, so it is not shown.",
        );
      setState(next);
      if (generate) setConsent(false);
    } catch (cause) {
      setError(
        cause instanceof Error &&
          cause.name !== "TimeoutError" &&
          cause.name !== "TypeError"
          ? cause.message
          : "This request could not be confirmed. Check for a saved explanation before trying again; your grades are unchanged.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="guide-note"
      aria-label="Optional AI website explanation"
    >
      <h3>
        <BookOpen size={17} /> Explain the saved website findings
      </h3>
      <p className="fine-print">
        Optional AI suggestions use bounded titles, descriptions, headings and
        recorded findings from the saved public scan. Private answers, financial
        details and account email are excluded. This is an explanation of dated
        excerpts, not a new scan or a grade.
      </p>
      {!state && (
        <button
          className="text-link"
          disabled={busy}
          onClick={() => void load()}
        >
          View saved explanation or options <ChevronDown size={15} />
        </button>
      )}
      {busy && (
        <p className="fine-print" role="status">
          {state
            ? "Checking the saved excerpts and explanation…"
            : "Checking explanation availability…"}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {state && (
        <p className="fine-print" role="status">
          {state.reason}
        </p>
      )}
      {state?.scanDate && (
        <p className="fine-print">
          Public scan dated {new Date(state.scanDate).toLocaleString()} ·{" "}
          {state.sourceCount} stored excerpts available. Source coverage is
          limited to that scan.
        </p>
      )}
      {state?.review && (
        <>
          <p className="fine-print">
            Generated {new Date(state.review.createdAt).toLocaleString()}
            {state.cached ? " · Saved explanation" : ""}. Suggestions have not
            been independently verified. Grades are unchanged.
          </p>
          {state.review.explanations.map((item, index) => {
            const source = state.review!.sources.find(
              (candidate) => candidate.id === item.sourceId,
            )!;
            return (
              <article className="guide-note" key={`${item.sourceId}:${index}`}>
                <strong>{item.title}</strong>
                <p>{item.explanation}</p>
                <p>
                  <strong>A small next step</strong> {item.suggestedNextStep}
                </p>
                <blockquote>{item.quote}</blockquote>
                <p className="fine-print">
                  Exact stored{" "}
                  {source.kind === "page_title"
                    ? "page title"
                    : source.kind === "page_description"
                      ? "page description"
                      : source.kind === "main_heading"
                        ? "main heading"
                        : "scanner observation"}{" "}
                  ·{" "}
                  <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                    Public source page
                  </a>{" "}
                  · observed {new Date(source.observedAt).toLocaleDateString()}
                </p>
              </article>
            );
          })}
          {state.review.abstainedReason && (
            <p className="guide-note">
              No explanation issued: {state.review.abstainedReason}
            </p>
          )}
          <details>
            <summary className="text-link">Source and method details</summary>
            <p className="fine-print">
              OpenAI model: {state.review.providerModel}. Requested model:{" "}
              {state.review.model}. Explanation method:{" "}
              {state.review.promptVersion}; format: {state.review.schemaVersion}
              . Quotes are checked against the supplied stored excerpts.
              Matching a quote does not establish that every interpretation is
              correct.
            </p>
          </details>
        </>
      )}
      {state?.enabled &&
        state.eligible &&
        ["ready", "unavailable"].includes(state.state) && (
          <>
            <label className="preference">
              <span>
                <strong>Use OpenAI for this explanation</strong>
                <small>{AI_REVIEW_CONSENT_TEXT}</small>
              </span>
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span
                className={`switch ${consent ? "on" : ""}`}
                aria-hidden="true"
              >
                <span />
              </span>
            </label>
            <p className="fine-print">
              OpenAI processes these public excerpts under its{" "}
              <a
                href="https://developers.openai.com/api/docs/guides/your-data"
                target="_blank"
                rel="noreferrer"
              >
                API data policies
              </a>
              . Up to three new explanations per account per UTC day; saved
              matching explanations can be reused. No automatic retry or
              background generation is requested by this screen.
            </p>
            <button
              className="btn btn-secondary btn-small"
              disabled={busy || !consent}
              onClick={() => void load(true)}
            >
              Explain these public excerpts
            </button>
          </>
        )}
      {(state || error) && (
        <button
          className="quiet-button"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
          Check saved explanation
        </button>
      )}
    </section>
  );
}
