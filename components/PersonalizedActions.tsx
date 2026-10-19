"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CloudActionProgress, CloudReport } from "../lib/account/types";
import { accountRecord } from "../lib/account/validation";
import type { OutcomePeriod } from "../lib/outcomes";
import { buildProgressInsights } from "../lib/progress-insights";
import {
  getPersonalizedActions,
  PERSONALIZATION_GOALS,
} from "../lib/personalized-actions";
import type { ActionProgress, ActionState } from "../lib/storage";
import type { Goal } from "../lib/types";
import ActionProgressControls from "./ActionProgressControls";
import "./personalized-actions.css";

const canonical = (reports: CloudReport[]) =>
  reports
    .filter((r) => r.canonical === true && !r.snapshot.isSample)
    .sort(
      (a, b) =>
        b.snapshot.createdAt.localeCompare(a.snapshot.createdAt) ||
        a.id.localeCompare(b.id),
    );
/** Private, transparent planning only; the immutable issued report is always the action source. */
export default function PersonalizedActions({
  reports,
  onReportsChanged,
}: {
  reports: CloudReport[];
  onReportsChanged?: () => void | Promise<void>;
}) {
  const id = useId(),
    ordered = useMemo(() => canonical(reports), [reports]);
  const initialized = useRef(ordered.length > 0),
    saving = useRef(false);
  const [selectedId, setSelectedId] = useState(() => ordered[0]?.id ?? "");
  const [goal, setGoal] = useState<Goal>(
    () =>
      ordered[0]?.snapshot.assessment.contextSnapshot.goal ??
      "sustainable_practice",
  );
  const [allowUnlinked, setAllowUnlinked] = useState(false);
  const [periods, setPeriods] = useState<OutcomePeriod[]>([]);
  const [periodsReady, setPeriodsReady] = useState(false);
  const [periodError, setPeriodError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [overrides, setOverrides] = useState<
    Record<string, CloudActionProgress[]>
  >({});
  useEffect(() => {
    if (!initialized.current && ordered.length) {
      initialized.current = true;
      setSelectedId(ordered[0].id);
      setGoal(ordered[0].snapshot.assessment.contextSnapshot.goal);
    }
  }, [ordered]);
  const loadOutcomes = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch("/api/account/outcomes", {
        cache: "no-store",
        credentials: "same-origin",
        signal: signal ?? AbortSignal.timeout(20_000),
      });
      const data: unknown = await r.json();
      if (!r.ok || !accountRecord(data) || !Array.isArray(data.periods))
        throw new Error("unavailable");
      const validated = buildProgressInsights(data.periods as OutcomePeriod[]);
      if (validated.status === "invalid") throw new Error("unavailable");
      if (signal?.aborted) return;
      setPeriods(validated.periods);
      setPeriodsReady(true);
      setPeriodError("");
    } catch {
      if (signal?.aborted) return;
      setPeriods([]);
      setPeriodsReady(false);
      setPeriodError(
        "Your business periods could not be checked. Suggestions use only the selected report and your action progress.",
      );
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void loadOutcomes(controller.signal);
    const reload = () => void loadOutcomes(controller.signal);
    window.addEventListener("grader:outcomes-changed", reload);
    return () => {
      controller.abort();
      window.removeEventListener("grader:outcomes-changed", reload);
    };
  }, [loadOutcomes]);
  const source = ordered.find((r) => r.id === selectedId);
  const selected = source
    ? {
        ...source,
        actionProgress: source.actionProgress.map((p) => {
          const newer = overrides[source.id]?.find(
            (o) => o.actionId === p.actionId,
          );
          return newer && newer.revision > p.revision ? newer : p;
        }),
      }
    : null;
  const result = selected
    ? getPersonalizedActions(selected, {
        goal,
        periods: periodsReady ? periods : [],
        allowUnlinkedForSelectedPractice: allowUnlinked,
      })
    : null;
  async function save(
    actionId: string,
    state: ActionState,
    details: ActionProgress,
  ) {
    if (!selected || saving.current) return;
    const item = result?.items.find(
      (item) => item.kind === "issued" && item.action.id === actionId,
    );
    const progress = selected.actionProgress.find(
      (p) => p.actionId === actionId,
    );
    if (!item || item.kind !== "issued" || !progress) return;
    saving.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/account/reports/${encodeURIComponent(selected.id)}/actions`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actionId,
            state,
            revision: progress.revision,
            details,
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      const data: unknown = await response.json();
      if (response.status === 409) {
        setMessage(
          "This action changed elsewhere. Refresh the saved reports before trying again; your change was not applied.",
        );
        await onReportsChanged?.();
        return;
      }
      if (
        !response.ok ||
        !accountRecord(data) ||
        !accountRecord(data.progress) ||
        data.progress.actionId !== actionId ||
        data.progress.state !== state ||
        data.progress.revision !== progress.revision + 1 ||
        typeof data.progress.updatedAt !== "string"
      )
        throw new Error("unconfirmed");
      const saved = data.progress as unknown as CloudActionProgress;
      setOverrides((previous) => ({
        ...previous,
        [selected.id]: [
          ...(previous[selected.id] || []).filter(
            (p) => p.actionId !== actionId,
          ),
          saved,
        ],
      }));
      setMessage(
        "Progress saved. Your issued assessment score is unchanged. Set-aside actions remain available in your saved report if you want to reopen them.",
      );
      try {
        await onReportsChanged?.();
      } catch {
        setMessage(
          "Progress saved. Refresh the saved reports to bring the rest of this page up to date. Your score is unchanged.",
        );
      }
      window.dispatchEvent(new Event("grader:actions-changed"));
    } catch {
      setMessage(
        "The save could not be confirmed. Refresh the saved reports before retrying; the request may have reached the server.",
      );
      try {
        await onReportsChanged?.();
      } catch {
        /* The visible status retains the safe recovery instruction. */
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      id="personalized-next-actions"
      className="account-subsection personalized-actions"
      aria-labelledby={`${id}-title`}
    >
      <h3 id={`${id}-title`}>Your next useful steps</h3>
      <p>
        Choose one saved report and a focus. We explain up to three next steps
        using that report’s issued actions, your progress and business measures
        you choose to use. This planning view never changes a grade.
      </p>
      {!ordered.length ? (
        <p>
          Save a real assessment in your account to get next steps from its
          issued action plan.
        </p>
      ) : (
        <>
          <div className="field-grid">
            <label className="field-label" htmlFor={`${id}-report`}>
              Source report
              <select
                aria-label="Source report"
                id={`${id}-report`}
                value={source ? selectedId : ""}
                disabled={busy}
                onChange={(e) => {
                  const next = ordered.find((r) => r.id === e.target.value);
                  setSelectedId(e.target.value);
                  setAllowUnlinked(false);
                  setMessage("");
                  if (next)
                    setGoal(next.snapshot.assessment.contextSnapshot.goal);
                }}
              >
                <option value="" disabled>
                  Choose a saved report
                </option>
                {ordered.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.snapshot.label} · {r.snapshot.createdAt.slice(0, 10)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label" htmlFor={`${id}-goal`}>
              Focus for this view
              <select
                aria-label="Focus for this view"
                id={`${id}-goal`}
                value={goal}
                disabled={busy || !source}
                onChange={(e) => setGoal(e.target.value as Goal)}
              >
                {PERSONALIZATION_GOALS.map((g) => (
                  <option value={g.value} key={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {source && periods.some((p) => p.baselineReportId === null) && (
            <div className="personalized-scope">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={allowUnlinked}
                  disabled={busy}
                  onChange={(e) => setAllowUnlinked(e.target.checked)}
                />
                <span>Use my unlinked business periods for this practice</span>
              </label>
              <p className="fine-print">
                Confirm only if those records describe this practice with the
                same definitions. This choice lasts in this view, resets when
                you select another report, and does not add a baseline link or
                research permission. Their practice match is your declaration.
              </p>
            </div>
          )}
          {periodError && (
            <p role="status">
              {periodError}{" "}
              <button
                type="button"
                className="quiet-button"
                onClick={() => void loadOutcomes()}
              >
                Retry business periods
              </button>
            </p>
          )}
          {!source ? (
            <p>
              The selected report is no longer available. Choose a saved report
              explicitly to continue.
            </p>
          ) : (
            result && (
              <>
                <p className="fine-print">
                  Source: {result.reportDate.slice(0, 10)} · rubric{" "}
                  {result.rubricVersion}. {result.note}
                </p>
                <ol className="personalized-step-list">
                  {result.items.map((item, index) => (
                    <li
                      className="personalized-step"
                      key={
                        item.kind === "issued"
                          ? `${selectedId}:${item.action.id}`
                          : "measurement"
                      }
                    >
                      <p className="eyebrow">
                        Step {index + 1} ·{" "}
                        {item.kind === "issued"
                          ? item.essential
                            ? "Reported essential control gap"
                            : "Issued action"
                          : "Measurement"}
                      </p>
                      <h4>
                        {item.kind === "issued"
                          ? item.action.title
                          : item.title}
                      </h4>
                      {item.kind === "issued" && <p>{item.action.summary}</p>}
                      <p>
                        <strong>Why now</strong>
                      </p>
                      <ul>
                        {item.whyNow.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                      {item.kind === "issued" && (
                        <details>
                          <summary>Original action steps</summary>
                          <ol>
                            {item.action.steps.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ol>
                        </details>
                      )}
                      <p className="personalized-measure">
                        <strong>What to check:</strong> {item.measure}
                      </p>
                      {item.kind === "issued" ? (
                        <ActionProgressControls
                          state={item.progress.state}
                          progress={item.progress.details}
                          outcomePrompt={item.action.verification}
                          disabled={busy}
                          onChange={(state, details) =>
                            void save(item.action.id, state, details)
                          }
                        />
                      ) : (
                        <a
                          className="btn btn-secondary btn-small"
                          href={item.href}
                        >
                          Review business periods and imports
                        </a>
                      )}
                    </li>
                  ))}
                </ol>
                {!result.items.length && (
                  <p>
                    No active issued actions are available for this focus and
                    capacity. Completed or set-aside actions remain in the saved
                    report; reopen one there if appropriate.
                  </p>
                )}
                <p className="fine-print">
                  Excluded from this shortlist: {result.excluded.done}{" "}
                  completed, {result.excluded.deferred} deferred,{" "}
                  {result.excluded.notRelevant} marked as not fitting, and{" "}
                  {result.excluded.capacity} requiring unavailable or
                  unconfirmed capacity. Reopen an action in your saved report to
                  reconsider it.
                </p>
              </>
            )
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
