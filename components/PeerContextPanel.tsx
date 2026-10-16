"use client";

import { useState } from "react";
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
  const preview = assessment ? privateSharePreview(assessment) : null;
  return (
    <section
      className="card community-card"
      aria-label="Peer context and recognition"
    >
      <Users size={26} aria-hidden="true" />
      <p className="eyebrow">YOUR OWN PROGRESS COMES FIRST</p>
      <h3>No peer rank before the evidence.</h3>
      <p>{availability.explanation}</p>
      <details>
        <summary className="text-link">What a useful comparison needs</summary>
        <ul className="fine-print">
          {availability.eligibility.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="fine-print">
          A future group will be self-selected. Its results will describe those
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
