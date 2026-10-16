"use client";

import { useId } from "react";
import { Check, Clock3, Play, RotateCcw } from "lucide-react";
import {
  isCalendarDate,
  type ActionProgress,
  type ActionState,
} from "../lib/storage";

export interface ActionProgressControlsProps {
  state: ActionState;
  progress?: ActionProgress;
  onChange: (state: ActionState, progress: ActionProgress) => void;
  outcomePrompt?: string;
  disabled?: boolean;
}

export default function ActionProgressControls({
  state,
  progress,
  onChange,
  outcomePrompt,
  disabled = false,
}: ActionProgressControlsProps) {
  const id = useId();
  function update(nextState: ActionState, patch: Partial<ActionProgress> = {}) {
    onChange(nextState, {
      ...progress,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }
  return (
    <div className="action-guide">
      <div className="action-controls" aria-label="Action progress">
        <button
          className={`btn btn-small ${state === "done" ? "btn-done" : "btn-secondary"}`}
          onClick={() => update(state === "done" ? "todo" : "done")}
          aria-pressed={state === "done"}
          disabled={disabled}
        >
          <Check size={15} />
          {state === "done" ? "Completed by you" : "Mark complete"}
        </button>
        {state !== "done" && (
          <button
            className="btn btn-secondary btn-small"
            onClick={() =>
              update(state === "in_progress" ? "todo" : "in_progress")
            }
            aria-pressed={state === "in_progress"}
            disabled={disabled}
          >
            {state === "in_progress" ? (
              <RotateCcw size={15} />
            ) : (
              <Play size={15} />
            )}
            {state === "in_progress" ? "Back to planned" : "Start this action"}
          </button>
        )}
        <button
          className="quiet-button"
          onClick={() => update(state === "deferred" ? "todo" : "deferred")}
          aria-pressed={state === "deferred"}
          disabled={disabled}
        >
          <Clock3 size={14} />
          {state === "deferred" ? "Bring back" : "Do later"}
        </button>
        <button
          className="quiet-button"
          onClick={() =>
            update(state === "not_relevant" ? "todo" : "not_relevant")
          }
          aria-pressed={state === "not_relevant"}
          disabled={disabled}
        >
          {state === "not_relevant" ? "Reconsider action" : "Doesn’t fit"}
        </button>
      </div>
      <p className="fine-print" role="status">
        {state === "done"
          ? "Completion reported by you. Your original assessment score stays unchanged."
          : state === "in_progress"
            ? "In progress. You can return here to record what changed."
            : state === "deferred"
              ? "Deferred. Bring this back when the timing works for you."
              : state === "not_relevant"
                ? "Set aside. Tell us why if you’d like to keep a record."
                : "Choose one useful next step. A target date is optional."}
      </p>
      <div className="field-grid">
        {state !== "not_relevant" && (
          <label className="field-label" htmlFor={`${id}-date`}>
            Target date (optional)
            <input
              id={`${id}-date`}
              type="date"
              value={progress?.targetDate ?? ""}
              disabled={disabled}
              onChange={(event) => {
                const value = event.target.value;
                if (!value || isCalendarDate(value))
                  update(state, { targetDate: value || undefined });
              }}
            />
          </label>
        )}
        {state === "not_relevant" && (
          <label className="field-label" htmlFor={`${id}-reason`}>
            Why doesn’t it fit? (optional)
            <select
              id={`${id}-reason`}
              value={progress?.relevanceReason ?? ""}
              disabled={disabled}
              onChange={(event) =>
                update(state, {
                  relevanceReason:
                    (event.target.value as ActionProgress["relevanceReason"]) ||
                    undefined,
                })
              }
            >
              <option value="">Choose a reason</option>
              <option value="already_done">Already in place</option>
              <option value="does_not_fit">
                Doesn’t match my practice or goal
              </option>
              <option value="incorrect_finding">
                The finding is incorrect
              </option>
              <option value="too_much_effort">Too much effort right now</option>
              <option value="other">Another reason</option>
            </select>
          </label>
        )}
        {state === "done" && (
          <label className="field-label" htmlFor={`${id}-outcome`}>
            Has it helped so far?
            <select
              id={`${id}-outcome`}
              value={progress?.outcome?.status ?? ""}
              disabled={disabled}
              onChange={(event) =>
                update(state, {
                  outcome: event.target.value
                    ? {
                        status: event.target.value as NonNullable<
                          ActionProgress["outcome"]
                        >["status"],
                        recordedAt: new Date().toISOString(),
                      }
                    : undefined,
                })
              }
            >
              <option value="">Not measured yet</option>
              <option value="improved">I’ve noticed improvement</option>
              <option value="no_change">No clear change yet</option>
              <option value="worse">It seems worse</option>
              <option value="unsure">I’m not sure</option>
            </select>
          </label>
        )}
      </div>
      {state === "done" && (
        <p className="fine-print">
          {outcomePrompt
            ? `${outcomePrompt} `
            : "Review the action’s suggested outcome. "}
          This is your observation, not an independently verified result.
          Reassess to record a new dated score.
        </p>
      )}
    </div>
  );
}
