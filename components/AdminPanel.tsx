"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AnswerValue,
  DomainId,
  QuestionDefinition,
  ReleaseSnapshot,
} from "../lib/types";
import {
  assessPractice,
  cloneReleaseSnapshot,
  validateRelease,
} from "../lib/scoring";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "../lib/demo";
import "./admin.css";

interface AdminPanelProps {
  activeRelease: ReleaseSnapshot;
  releaseHistory: ReleaseSnapshot[];
  onPublish: (release: ReleaseSnapshot) => void;
  onReset: () => void;
}

const percent = (value: number) =>
  Number.isFinite(value) ? Math.round(value * 100) : "—";
const numeric = (value: number) => (Number.isFinite(value) ? value : "");

function sampleAssessment(release: ReleaseSnapshot) {
  if (validateRelease(release).length) return null;
  return assessPractice({
    context: SAMPLE_CONTEXT,
    answers: SAMPLE_ANSWERS,
    controls: SAMPLE_CONTROLS,
    release,
  });
}

export default function AdminPanel({
  activeRelease,
  releaseHistory,
  onPublish,
  onReset,
}: AdminPanelProps) {
  const [draft, setDraft] = useState(() => cloneReleaseSnapshot(activeRelease));
  const [selectedDomain, setSelectedDomain] = useState<DomainId>(
    activeRelease.domains[0].id,
  );
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    setDraft(cloneReleaseSnapshot(activeRelease));
  }, [activeRelease]);

  const errors = useMemo(() => validateRelease(draft), [draft]);
  const currentSample = useMemo(
    () => sampleAssessment(activeRelease),
    [activeRelease],
  );
  const draftSample = useMemo(() => sampleAssessment(draft), [draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(activeRelease);
  const selectedQuestions = draft.questions.filter(
    (question) => question.domain === selectedDomain,
  );
  const history = Array.from(
    new Map(
      [activeRelease, ...releaseHistory].map((release) => [
        release.id,
        release,
      ]),
    ).values(),
  );
  const selectedDefinition = draft.domains.find(
    (domain) => domain.id === selectedDomain,
  )!;

  const noteChange = () => {
    setMessage("");
    setMessageIsError(false);
  };

  const updateQuestion = (id: string, patch: Partial<QuestionDefinition>) => {
    noteChange();
    setDraft((previous) => ({
      ...previous,
      questions: previous.questions.map((question) =>
        question.id === id ? { ...question, ...patch } : question,
      ),
    }));
  };

  const updateOptionLabel = (
    questionId: string,
    value: AnswerValue,
    label: string,
  ) => {
    noteChange();
    setDraft((previous) => ({
      ...previous,
      questions: previous.questions.map((question) =>
        question.id === questionId
          ? {
              ...question,
              options: question.options.map((option) =>
                option.value === value ? { ...option, label } : option,
              ),
            }
          : question,
      ),
    }));
  };

  const publish = (source: ReleaseSnapshot, restoredFrom?: string) => {
    const next = cloneReleaseSnapshot(source);
    next.id = `preview-local-${Date.now()}`;
    next.label = `Local rubric · version ${history.length + 1}`;
    next.status = "approved";
    next.provisional = true;
    const nextErrors = validateRelease(next);
    if (nextErrors.length) {
      setMessage(nextErrors.join(" "));
      setMessageIsError(true);
      return;
    }
    try {
      onPublish(next);
      setDraft(cloneReleaseSnapshot(next));
      setMessage(
        `${next.label} is active in this browser.${restoredFrom ? ` Based on ${restoredFrom}.` : ""} Saved assessment results keep their original rubric.`,
      );
      setMessageIsError(false);
    } catch {
      setMessage(
        "The local version could not be published. Your draft is still available; check browser storage and try again.",
      );
      setMessageIsError(true);
    }
  };

  const discardDraft = () => {
    setDraft(cloneReleaseSnapshot(activeRelease));
    setMessage(
      "Draft changes discarded. The active local rubric is unchanged.",
    );
    setMessageIsError(false);
  };

  const restoreDefaults = () => {
    try {
      onReset();
      setDraft(cloneReleaseSnapshot(activeRelease));
      setMessage(
        "Default rubric restored locally. Saved assessment results keep their original rubric.",
      );
      setMessageIsError(false);
    } catch {
      setMessage(
        "The default rubric could not be restored. Check browser storage and try again.",
      );
      setMessageIsError(true);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="admin-title">
      <div className="admin-heading">
        <div>
          <p className="eyebrow">LOCAL ADMIN PREVIEW</p>
          <h2 id="admin-title">Local release controls</h2>
          <p className="admin-intro">
            Refine questions and weights, preview the effect, then publish a new
            local version.
          </p>
        </div>
        <span className="tag">Provisional rubric</span>
      </div>

      <div className="admin-notice" role="note">
        <span className="admin-notice-icon" aria-hidden="true">
          i
        </span>
        <div>
          <strong>Local demo controls. No protected admin account.</strong>
          <p>
            Changes stay in this browser. This screen has no authentication,
            permissions or server-side review. It does not change anyone
            else&apos;s assessment.
          </p>
        </div>
      </div>

      <div className="admin-release-bar">
        <div>
          <span className="admin-small-label">Active version</span>
          <strong>{activeRelease.label}</strong>
        </div>
        <div>
          <span className="admin-small-label">Question library</span>
          <strong>
            {draft.questions.length} questions · {draft.domains.length} areas
          </strong>
        </div>
        <div>
          <span className="admin-small-label">Draft status</span>
          <strong className={dirty ? "admin-draft-status" : ""}>
            {dirty ? "Unpublished changes" : "Matches active version"}
          </strong>
        </div>
      </div>

      <div className="admin-section-heading">
        <div>
          <p className="eyebrow">01 · CALIBRATE</p>
          <h2>Weights and evidence</h2>
        </div>
        <p className="muted">
          Evidence coverage controls whether a result can be shown. It is
          separate from the score.
        </p>
      </div>
      <div className="admin-settings-grid">
        <div className="admin-surface">
          <h3>Relative area weights</h3>
          <p className="admin-help">
            These weights shape an eligible summary. They do not change the
            scores within each area.
          </p>
          <div className="admin-weight-grid">
            {draft.domains.map((domain) => (
              <label className="admin-weight-field" key={domain.id}>
                <span>{domain.title}</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={numeric(domain.weight)}
                  onChange={(event) => {
                    const weight = event.currentTarget.valueAsNumber;
                    noteChange();
                    setDraft((previous) => ({
                      ...previous,
                      domains: previous.domains.map((item) =>
                        item.id === domain.id ? { ...item, weight } : item,
                      ),
                    }));
                  }}
                />
              </label>
            ))}
          </div>
        </div>
        <div className="admin-surface admin-coverage-card">
          <h3>Minimum evidence coverage</h3>
          <label className="admin-coverage-field">
            <span>Required applicable weight</span>
            <div>
              <input
                type="number"
                min="80"
                max="100"
                step="1"
                value={numeric(Math.round(draft.minCoverage * 100))}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  noteChange();
                  setDraft((previous) => ({
                    ...previous,
                    minCoverage: value / 100,
                  }));
                }}
              />
              <span aria-hidden="true">%</span>
            </div>
          </label>
          <p className="admin-help">
            Allowed range: 80–100%. Every required question must also have an
            applicable answer. Unknown is never zero.
          </p>
          <p className="admin-policy-note">
            Answer points stay fixed at 0, 40, 70 and 100 in this preview. They
            are provisional product rules, not industry benchmarks.
          </p>
        </div>
      </div>

      <div className="admin-section-heading">
        <div>
          <p className="eyebrow">02 · REFINE</p>
          <h2>Questions with a purpose</h2>
        </div>
        <p className="muted">
          Edit wording and relative weight. A zero question weight disables that
          question.
        </p>
      </div>
      <div className="admin-question-layout">
        <nav className="admin-domain-nav" aria-label="Question areas">
          {draft.domains.map((domain) => (
            <button
              className={
                selectedDomain === domain.id
                  ? "admin-domain-button admin-domain-selected"
                  : "admin-domain-button"
              }
              type="button"
              key={domain.id}
              aria-pressed={selectedDomain === domain.id}
              onClick={() => setSelectedDomain(domain.id)}
            >
              <span>{domain.title}</span>
              <span className="admin-domain-count">
                {
                  draft.questions.filter(
                    (question) => question.domain === domain.id,
                  ).length
                }
              </span>
            </button>
          ))}
        </nav>
        <div
          className="admin-question-area"
          aria-label={`${selectedDefinition.title} questions`}
        >
          {selectedQuestions.map((question, index) => (
            <article
              className="admin-surface admin-question-card"
              key={question.id}
            >
              <div className="admin-question-meta">
                <span className="admin-question-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="admin-small-label">{question.id}</span>
                {question.weight === 0 && <span className="tag">Disabled</span>}
              </div>
              <label className="admin-field">
                <span>Question</span>
                <input
                  type="text"
                  value={question.title}
                  onChange={(event) =>
                    updateQuestion(question.id, {
                      title: event.currentTarget.value,
                    })
                  }
                />
              </label>
              <label className="admin-field">
                <span>Help and context</span>
                <textarea
                  rows={2}
                  value={question.help}
                  onChange={(event) =>
                    updateQuestion(question.id, {
                      help: event.currentTarget.value,
                    })
                  }
                />
              </label>
              <div className="admin-question-controls">
                <label className="admin-question-weight">
                  <span>Relative weight</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={numeric(question.weight)}
                    onChange={(event) =>
                      updateQuestion(question.id, {
                        weight: event.currentTarget.valueAsNumber,
                      })
                    }
                  />
                </label>
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    checked={question.mandatory}
                    onChange={(event) =>
                      updateQuestion(question.id, {
                        mandatory: event.currentTarget.checked,
                      })
                    }
                  />
                  <span>Required before this area is scored</span>
                </label>
              </div>
              <details className="admin-options">
                <summary>
                  Edit answer wording{" "}
                  <span className="admin-options-note">Fixed points</span>
                </summary>
                <div className="admin-option-list">
                  {question.options.map((option) => (
                    <label className="admin-option-field" key={option.value}>
                      <span>
                        {option.points === null
                          ? option.value === "unknown"
                            ? "Unknown"
                            : "Not applicable"
                          : `${option.points} points`}
                      </span>
                      <input
                        type="text"
                        value={option.label}
                        onChange={(event) =>
                          updateOptionLabel(
                            question.id,
                            option.value,
                            event.currentTarget.value,
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
            </article>
          ))}
        </div>
      </div>

      <div className="admin-section-heading">
        <div>
          <p className="eyebrow">03 · CHECK THE EFFECT</p>
          <h2>A preview before you publish</h2>
        </div>
        <p className="muted">
          The same fictional answers, assessed with the active rubric and your
          draft.
        </p>
      </div>
      <div className="admin-surface admin-impact">
        <div className="admin-impact-heading">
          <div>
            <h3>Juniper Family Law</h3>
            <p className="admin-help">
              Fictional Oregon solo · cash-collection goal · owner-reported
              example answers
            </p>
          </div>
          <span className="tag">Sample, not live firm data</span>
        </div>
        <div className="admin-table-scroll">
          <table className="admin-impact-table">
            <caption className="admin-visually-hidden">
              Effect of the draft on fictional example module scores and
              evidence coverage
            </caption>
            <thead>
              <tr>
                <th scope="col">Area</th>
                <th scope="col">Active</th>
                <th scope="col">Draft</th>
                <th scope="col">Change</th>
                <th scope="col">Draft coverage</th>
              </tr>
            </thead>
            <tbody>
              {draft.domains.map((domain) => {
                const before = currentSample?.domains.find(
                  (item) => item.id === domain.id,
                );
                const after = draftSample?.domains.find(
                  (item) => item.id === domain.id,
                );
                const delta =
                  before?.score !== null &&
                  before?.score !== undefined &&
                  after?.score !== null &&
                  after?.score !== undefined
                    ? Math.round((after.score - before.score) * 10) / 10
                    : null;
                return (
                  <tr key={domain.id}>
                    <th scope="row">{domain.title}</th>
                    <td>
                      {before?.score ??
                        (before?.status === "not_applicable"
                          ? "Not applicable"
                          : "Incomplete")}
                    </td>
                    <td>
                      {after
                        ? (after.score ??
                          (after.status === "not_applicable"
                            ? "Not applicable"
                            : "Incomplete"))
                        : "Needs valid draft"}
                    </td>
                    <td>
                      <span
                        className={
                          delta !== null && delta !== 0
                            ? "admin-delta"
                            : "admin-neutral"
                        }
                      >
                        {delta === null ? "—" : delta > 0 ? `+${delta}` : delta}
                      </span>
                    </td>
                    <td>{after ? `${percent(after.coverage)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="admin-policy-note">
          A changed rubric can change a score. It does not show that this
          fictional practice improved. Existing saved results keep their
          original questions and weights.
        </p>
      </div>

      <div
        className={
          errors.length
            ? "admin-validation admin-validation-errors"
            : "admin-validation"
        }
        aria-live="polite"
      >
        <strong>
          {errors.length
            ? `${errors.length} ${errors.length === 1 ? "issue" : "issues"} to resolve before publishing`
            : "Draft validation passed"}
        </strong>
        {errors.length ? (
          <ul>
            {errors.map((error, index) => (
              <li key={`${index}-${error}`}>{error}</li>
            ))}
          </ul>
        ) : (
          <p>
            Types, weights, coverage, references and fixed answer points meet
            the preview rules. This does not replace domain review.
          </p>
        )}
      </div>
      <div className="admin-publish-row">
        <div>
          <strong>
            {dirty
              ? "Ready when your draft is."
              : "Your active version is up to date."}
          </strong>
          <p className="admin-help">
            Publishing creates a new local version. It does not rewrite saved
            results.
          </p>
        </div>
        <div className="admin-button-group">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!dirty}
            onClick={discardDraft}
          >
            Discard draft
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={errors.length > 0 || !dirty}
            onClick={() => publish(draft)}
          >
            Publish local version
          </button>
        </div>
      </div>
      {message && (
        <p
          className={
            messageIsError ? "admin-status admin-status-error" : "admin-status"
          }
          role="status"
        >
          {message}
        </p>
      )}

      <div className="admin-section-heading">
        <div>
          <p className="eyebrow">RELEASE HISTORY</p>
          <h2>Every version has a place.</h2>
        </div>
        <p className="muted">
          Reusing a prior rubric publishes another version. History stays
          intact.
        </p>
      </div>
      <div className="admin-history">
        {history.map((release) => (
          <div className="admin-history-item" key={release.id}>
            <div>
              <strong>{release.label}</strong>
              <p>
                {release.questions.length} questions ·{" "}
                {percent(release.minCoverage)}% minimum coverage · provisional
              </p>
            </div>
            {release.id === activeRelease.id ? (
              <span className="tag admin-active-tag">Active</span>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => publish(release, release.label)}
              >
                Republish this rubric
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="admin-reset-row">
        <p className="admin-help">
          Want the original starting point? Restore the default rubric without
          changing saved assessment snapshots.
        </p>
        <button
          type="button"
          className="admin-text-button"
          onClick={restoreDefaults}
        >
          Restore default rubric
        </button>
      </div>
    </section>
  );
}
