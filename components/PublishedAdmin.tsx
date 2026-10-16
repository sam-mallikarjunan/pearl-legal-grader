"use client";

import { useEffect, useMemo, useState } from "react";
import {
  canonicalJson,
  compareConfiguration,
  validatePublishedConfig,
  type ConfigHistoryEntry,
  type ConfigRelease,
} from "../lib/configuration";
import type {
  ActionTemplate,
  DomainId,
  QuestionDefinition,
  ReleaseSnapshot,
} from "../lib/types";
import "./published-admin.css";

type Loaded = { active: ConfigRelease; history: ConfigHistoryEntry[] };
const displayScore = (value: number | null) =>
  value === null ? "Incomplete" : String(value);
const percent = (value: number) => `${Math.round(value * 100)}%`;

export default function PublishedAdmin() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<ReleaseSnapshot | null>(null);
  const [domain, setDomain] = useState<DomainId>("presence");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [access, setAccess] = useState<
    "loading" | "allowed" | "sign_in" | "forbidden" | "error"
  >("loading");
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState("");

  async function load() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/config", { cache: "no-store" });
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
        throw new Error(
          body.error || "The published configuration could not be loaded.",
        );
      const result = body as Loaded;
      if (validatePublishedConfig(result.active.release).length)
        throw new Error("The published configuration could not be validated.");
      setLoaded(result);
      setDraft(structuredClone(result.active.release));
      setAdvanced(JSON.stringify(result.active.release, null, 2));
      setAccess("allowed");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The configuration could not be loaded.",
      );
      setAccess("error");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const errors = useMemo(
    () => (draft ? validatePublishedConfig(draft) : []),
    [draft],
  );
  const impact = useMemo(
    () =>
      loaded && draft ? compareConfiguration(loaded.active.release, draft) : [],
    [loaded, draft],
  );
  const dirty = Boolean(
    loaded &&
      draft &&
      canonicalJson(loaded.active.release) !== canonicalJson(draft),
  );
  const validReason = reason.trim().length >= 10 && reason.trim().length <= 500;

  function update(patch: Partial<ReleaseSnapshot>) {
    setMessage("");
    setDraft((value) => (value ? { ...value, ...patch } : value));
  }
  function question(id: string, patch: Partial<QuestionDefinition>) {
    if (draft)
      update({
        questions: draft.questions.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      });
  }
  function action(id: string, patch: Partial<ActionTemplate>) {
    if (draft)
      update({
        actions: draft.actions.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      });
  }
  async function change(rollbackId?: string) {
    if (!loaded || !draft || !validReason || (!rollbackId && errors.length))
      return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        rollbackId ? "/api/admin/config/rollback" : "/api/admin/config",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            release: rollbackId ? undefined : draft,
            releaseId: rollbackId,
            expectedActiveId: loaded.active.release.id,
            reason,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "The change could not be published.");
      await load();
      setReason("");
      setMessage(
        rollbackId
          ? "The selected published version is active. Issued reports are unchanged."
          : "A new version is published. New assessments use it; issued reports are unchanged.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The change could not be published.",
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
          <h1>Methodology administration</h1>
          <p>
            Review supported question, weight and action changes before
            publishing a new version.
          </p>
        </div>
        <div>
          <a href="/admin/insights">Learning and requested help</a>
          <p>
            <a href="/">Return to the grader</a>
          </p>
        </div>
      </header>
      {access === "loading" && (
        <p role="status">Checking administrator access…</p>
      )}
      {access === "sign_in" && (
        <section className="pa-card">
          <h2>Sign in to continue</h2>
          <p>
            This area requires a verified account with administrator access.
          </p>
          <a href="/account?next=/admin">Open account sign-in</a>
        </section>
      )}
      {access === "forbidden" && (
        <section className="pa-card">
          <h2>Administrator access required</h2>
          <p>
            Your account does not have permission to publish the scoring
            methodology.
          </p>
          <a href="/account">Your account</a>
        </section>
      )}
      {access === "error" && (
        <section className="pa-card">
          <p role="alert">{message}</p>
          <button onClick={() => void load()} disabled={busy}>
            Try again
          </button>
        </section>
      )}
      {access === "allowed" && loaded && draft && (
        <>
          <section className="pa-card pa-summary">
            <div>
              <strong>Active version</strong>
              <p>{loaded.active.release.label}</p>
              <code>{loaded.active.release.id}</code>
            </div>
            <div>
              <strong>Published</strong>
              <p>
                {loaded.active.publishedAt
                  ? new Date(loaded.active.publishedAt).toLocaleString()
                  : "Application default"}
              </p>
              <small>SHA-256: {loaded.active.contentHash}</small>
            </div>
            <div>
              <strong>Draft</strong>
              <p>{dirty ? "Unpublished changes" : "Matches active version"}</p>
              <small>Saved reports retain their issued methodology.</small>
            </div>
          </section>
          <section className="pa-card">
            <h2>Release settings</h2>
            <div className="pa-fields">
              <label>
                Version label
                <input
                  maxLength={150}
                  value={draft.label}
                  onChange={(event) => update({ label: event.target.value })}
                />
              </label>
              <label>
                Minimum applicable evidence (%)
                <input
                  type="number"
                  min={80}
                  max={100}
                  step={1}
                  value={
                    Number.isFinite(draft.minCoverage)
                      ? draft.minCoverage * 100
                      : ""
                  }
                  onChange={(event) =>
                    update({ minCoverage: event.target.valueAsNumber / 100 })
                  }
                />
              </label>
              <label className="pa-wide">
                Rubric explanation
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={draft.rubricNote}
                  onChange={(event) =>
                    update({ rubricNote: event.target.value })
                  }
                />
              </label>
            </div>
            <p className="pa-note">
              The rubric remains provisional. Answer points stay at 0, 40, 70
              and 100. Unknown evidence never becomes zero; essential control
              findings remain outside the average.
            </p>
            <div className="pa-weights">
              {draft.domains.map((item) => (
                <label key={item.id}>
                  {item.title}
                  <input
                    type="number"
                    min={0.1}
                    max={100}
                    step={0.1}
                    value={Number.isFinite(item.weight) ? item.weight : ""}
                    onChange={(event) =>
                      update({
                        domains: draft.domains.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, weight: event.target.valueAsNumber }
                            : entry,
                        ),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </section>
          <section className="pa-card">
            <h2>Question library</h2>
            <nav className="pa-tabs" aria-label="Question areas">
              {draft.domains.map((item) => (
                <button
                  key={item.id}
                  className={domain === item.id ? "pa-selected" : ""}
                  aria-pressed={domain === item.id}
                  onClick={() => setDomain(item.id)}
                >
                  {item.title}
                </button>
              ))}
            </nav>
            <div className="pa-question-list">
              {draft.questions
                .filter((item) => item.domain === domain)
                .map((item) => (
                  <article className="pa-question" key={item.id}>
                    <code>{item.id}</code>
                    <label>
                      Question
                      <input
                        maxLength={300}
                        value={item.title}
                        onChange={(event) =>
                          question(item.id, { title: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Help
                      <textarea
                        maxLength={2000}
                        rows={2}
                        value={item.help}
                        onChange={(event) =>
                          question(item.id, { help: event.target.value })
                        }
                      />
                    </label>
                    <div className="pa-fields">
                      <label>
                        Relative weight
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={
                            Number.isFinite(item.weight) ? item.weight : ""
                          }
                          onChange={(event) =>
                            question(item.id, {
                              weight: event.target.valueAsNumber,
                            })
                          }
                        />
                      </label>
                      <label>
                        Applicability
                        <select
                          value={item.applicability}
                          onChange={(event) =>
                            question(item.id, {
                              applicability: event.target
                                .value as QuestionDefinition["applicability"],
                            })
                          }
                        >
                          <option value="always">All practices</option>
                          <option value="website">
                            Practices with a website
                          </option>
                          <option value="invoiced_fees">
                            Invoiced-fee practices
                          </option>
                        </select>
                      </label>
                    </div>
                    <label className="pa-checkbox">
                      <input
                        type="checkbox"
                        checked={item.mandatory}
                        onChange={(event) =>
                          question(item.id, { mandatory: event.target.checked })
                        }
                      />
                      Required evidence before this area is scored
                    </label>
                    <details>
                      <summary>Answer wording</summary>
                      {item.options.map((option) => (
                        <label key={option.value}>
                          {option.points === null
                            ? option.value
                            : `${option.points} points`}
                          <input
                            maxLength={500}
                            value={option.label}
                            onChange={(event) =>
                              question(item.id, {
                                options: item.options.map((entry) =>
                                  entry.value === option.value
                                    ? { ...entry, label: event.target.value }
                                    : entry,
                                ),
                              })
                            }
                          />
                        </label>
                      ))}
                    </details>
                  </article>
                ))}
            </div>
          </section>
          <section className="pa-card">
            <h2>Recommended actions</h2>
            <p>
              Action eligibility, goal fit and capacity rules remain
              deterministic and versioned.
            </p>
            <div className="pa-question-list">
              {draft.actions
                .filter((item) => item.domain === domain)
                .map((item) => (
                  <details className="pa-question" key={item.id}>
                    <summary>{item.title}</summary>
                    <code>{item.id}</code>
                    <label>
                      Title
                      <input
                        value={item.title}
                        maxLength={200}
                        onChange={(event) =>
                          action(item.id, { title: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Why it matters
                      <textarea
                        value={item.summary}
                        maxLength={2000}
                        onChange={(event) =>
                          action(item.id, { summary: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Steps (one per line)
                      <textarea
                        rows={4}
                        value={item.steps.join("\n")}
                        onChange={(event) =>
                          action(item.id, {
                            steps: event.target.value.split("\n"),
                          })
                        }
                      />
                    </label>
                    <label>
                      Definition of done
                      <textarea
                        value={item.definitionOfDone}
                        maxLength={2000}
                        onChange={(event) =>
                          action(item.id, {
                            definitionOfDone: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Outcome to review
                      <textarea
                        value={item.verification}
                        maxLength={2000}
                        onChange={(event) =>
                          action(item.id, { verification: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Effort
                      <input
                        value={item.effort}
                        maxLength={150}
                        onChange={(event) =>
                          action(item.id, { effort: event.target.value })
                        }
                      />
                    </label>
                  </details>
                ))}
            </div>
          </section>
          <section className="pa-card">
            <h2>Impact on frozen examples</h2>
            <p>
              These fictional profiles test missing information, applicability
              and capacity. Score changes caused by methodology are not evidence
              of a practice improving.
            </p>
            <div className="pa-table">
              <table>
                <thead>
                  <tr>
                    <th>Practice profile</th>
                    <th>Active summary</th>
                    <th>Draft summary</th>
                    <th>Evidence coverage</th>
                    <th>Action changes</th>
                  </tr>
                </thead>
                <tbody>
                  {impact.map((item) => (
                    <tr key={item.id}>
                      <th>
                        {item.label}
                        <details>
                          <summary>Area scores</summary>
                          {item.domainChanges.map((entry) => (
                            <p key={entry.id}>
                              {entry.id}: {displayScore(entry.before)} →{" "}
                              {displayScore(entry.after)}
                            </p>
                          ))}
                        </details>
                      </th>
                      <td>{displayScore(item.before)}</td>
                      <td>{displayScore(item.after)}</td>
                      <td>
                        {percent(item.coverageBefore)} →{" "}
                        {percent(item.coverageAfter)}
                      </td>
                      <td>
                        {item.actionsAdded.length
                          ? `Added: ${item.actionsAdded.join("; ")}. `
                          : ""}
                        {item.actionsRemoved.length
                          ? `Removed: ${item.actionsRemoved.join("; ")}.`
                          : ""}
                        {!item.actionsAdded.length &&
                          !item.actionsRemoved.length &&
                          "Unchanged"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="pa-card">
            <h2>Validate and publish</h2>
            {errors.length ? (
              <div role="alert">
                <strong>{errors.length} issues to resolve</strong>
                <ul>
                  {errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p>
                Typed rules, references, evidence policy and fixed rubric points
                passed validation. Domain judgment still requires review.
              </p>
            )}
            <label>
              Reason for publishing or restoring a version
              <textarea
                value={reason}
                minLength={10}
                maxLength={500}
                rows={3}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain the change, evidence and expected effect."
              />
            </label>
            <p className="pa-note">
              Publication affects new assessments. Active drafts and previously
              issued reports retain their pinned release. Concurrent changes
              require a fresh review.
            </p>
            <div className="pa-buttons">
              <button
                disabled={busy || !dirty || errors.length > 0 || !validReason}
                onClick={() => void change()}
              >
                Publish new version
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setDraft(structuredClone(loaded.active.release));
                  setMessage(
                    "Draft discarded. The published version is unchanged.",
                  );
                }}
              >
                Discard draft
              </button>
              <button disabled={busy} onClick={() => void load()}>
                Reload published version
              </button>
            </div>
            {message && <p role="status">{message}</p>}
          </section>
          <section className="pa-card">
            <h2>Published history</h2>
            <p>
              Restoring a version moves the active pointer and writes an audit
              entry. It does not alter the saved release.
            </p>
            {loaded.history.map((item) => (
              <article className="pa-history" key={item.release.id}>
                <div>
                  <strong>{item.release.label}</strong>
                  <p>
                    <code>{item.release.id}</code>
                  </p>
                  <p>{item.reason}</p>
                  <small>
                    {item.publishedAt
                      ? new Date(item.publishedAt).toLocaleString()
                      : "Application default"}
                  </small>
                </div>
                <button
                  disabled={
                    busy ||
                    item.release.id === loaded.active.release.id ||
                    !validReason
                  }
                  onClick={() => void change(item.release.id)}
                >
                  {item.release.id === loaded.active.release.id
                    ? "Active"
                    : "Restore this version"}
                </button>
              </article>
            ))}
          </section>
          <details className="pa-card">
            <summary>Advanced typed configuration</summary>
            <p>
              Edit supported question/action structures, order, goal routing and
              references as JSON. Executable scripts, new collector types and
              new operators are not supported.
            </p>
            <button
              disabled={busy}
              onClick={() => setAdvanced(JSON.stringify(draft, null, 2))}
            >
              Copy current draft into editor
            </button>
            <label>
              Complete draft JSON
              <textarea
                className="pa-json"
                rows={18}
                value={advanced}
                onChange={(event) => setAdvanced(event.target.value)}
              />
            </label>
            <button
              disabled={busy || advanced.length > 200_000}
              onClick={() => {
                try {
                  const parsed: unknown = JSON.parse(advanced);
                  const issues = validatePublishedConfig(parsed);
                  if (issues.length) {
                    setMessage(issues.slice(0, 8).join(" "));
                    return;
                  }
                  setDraft(parsed as ReleaseSnapshot);
                  setMessage(
                    "JSON applied to the unpublished draft. Review its impact before publishing.",
                  );
                } catch {
                  setMessage("The editor does not contain valid JSON.");
                }
              }}
            >
              Apply JSON to draft
            </button>
          </details>
        </>
      )}
    </main>
  );
}
