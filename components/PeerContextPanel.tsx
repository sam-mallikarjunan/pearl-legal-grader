"use client";

import { useEffect, useState } from "react";
import { Eye, LockKeyhole, Users } from "lucide-react";
import type { SavedAssessment } from "../lib/storage";
import { benchmarkAvailability, privateSharePreview } from "../lib/peer";

export interface PeerContextPanelProps {
  assessment?: SavedAssessment;
}

export default function PeerContextPanel({
  assessment,
}: PeerContextPanelProps) {
  const [showPreview, setShowPreview] = useState(false);
  const availability = benchmarkAvailability();
  const [published, setPublished] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/benchmarks", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((value) => {
        if (!controller.signal.aborted)
          setPublished(
            value?.status === "descriptive" &&
              value?.publicationEnabled === true,
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const preview = assessment ? privateSharePreview(assessment) : null;
  return (
    <section
      className="card community-card"
      aria-label="Peer context and recognition"
    >
      <Users size={26} aria-hidden="true" />
      <p className="eyebrow">YOUR OWN PROGRESS COMES FIRST</p>
      <h3>Use comparisons with context.</h3>
      <p>
        {published
          ? "Descriptive comparisons from eligible consenting workspaces are available. They describe participants under this rubric, not the legal profession."
          : "Published industry observations can help you choose what to measure. Community comparisons appear only when enough eligible workspaces contribute; no peer percentile is inferred from your score."}
      </p>
      <div className="dialog-data-actions">
        <a href="/benchmarks">Explore industry benchmarks</a>
        <a href="/leaderboard">See opt-in recognition</a>
      </div>
      <details>
        <summary className="text-link">What a useful comparison needs</summary>
        <ul className="fine-print">
          {availability.eligibility.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="fine-print">
          A community group is self-selected. Its results describe those
          participants, not the whole legal profession. Your score never depends
          on contribution, public sharing or a product purchase.
        </p>
      </details>
      {preview && (
        <>
          <button
            className="text-link"
            onClick={() => setShowPreview((shown) => !shown)}
            aria-expanded={showPreview}
          >
            <Eye size={15} />
            {showPreview
              ? "Hide private recognition preview"
              : "Preview recognition privately"}
          </button>
          {showPreview && (
            <div
              className="guide-note"
              aria-label="Private recognition preview"
            >
              <p className="eyebrow">
                <LockKeyhole size={13} /> PRIVATE PREVIEW
              </p>
              <h3>{preview.title}</h3>
              <p>
                <strong>{preview.scope}</strong>
              </p>
              <p>
                {preview.score === null
                  ? "More evidence is needed before a score can be shown."
                  : `${Math.round(preview.score)}/100 · ${Math.round(preview.coverage * 100)}% evidence coverage`}
              </p>
              <p className="fine-print">
                {new Date(preview.asOf).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}{" "}
                · {preview.releaseLabel}
              </p>
              <p className="fine-print">{preview.evidenceNote}</p>
              <p className="fine-print">{preview.publicationNote}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
