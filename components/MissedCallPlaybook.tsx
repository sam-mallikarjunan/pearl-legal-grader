"use client";

import { useEffect, useId, useState } from "react";
import type { CloudReport } from "../lib/account/types";
import {
  buildCallbackPlaybook,
  CALLBACK_ACTION_IDS,
  CALLBACK_CLOCK,
  CALLBACK_QUEUE_HEADINGS,
  CALLBACK_SCRIPT,
  CALLBACK_VOICEMAIL,
  CALLBACK_WINDOWS,
  callbackCoverage,
  callbackStopRule,
  callbackTimeliness,
  DEFAULT_CALLBACK_SETUP,
  type CallbackSetup,
} from "../lib/missed-call-playbook";
import "./missed-call-playbook.css";

function downloadTemplate(name: string, content: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

const percent = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 1,
});

function CallbackSelfCheck({ target }: { target: CallbackSetup["target"] }) {
  const id = useId();
  const [eligible, setEligible] = useState("");
  const [timely, setTimely] = useState("");
  const result =
    eligible === "" || timely === ""
      ? null
      : callbackTimeliness(eligible, timely);

  return (
    <details className="missed-call-subpanel">
      <summary>Optional: check the callback numbers</summary>
      <p>
        Pick one received-date window and wait until all those callback
        deadlines have passed. Count each unique eligible missed new-intake call
        once and include late and never-called eligible calls. Exclude
        duplicates, non-intake calls, and calls with no safe return route; note
        those exclusions separately in your own system.
      </p>
      <p>
        Count only the first human callback attempt within{" "}
        {CALLBACK_WINDOWS[target]}. An automated acknowledgment or a later
        attempt doesn’t count. Enter two totals only. This calculator does not
        store or send them.
      </p>
      <div className="missed-call-grid">
        <label className="field-label">
          Eligible missed calls
          <input
            aria-describedby={`${id}-result`}
            inputMode="numeric"
            maxLength={7}
            value={eligible}
            onChange={(event) => {
              if (/^\d{0,7}$/.test(event.target.value))
                setEligible(event.target.value);
            }}
          />
        </label>
        <label className="field-label">
          Calls attempted within target
          <input
            aria-describedby={`${id}-result`}
            inputMode="numeric"
            maxLength={7}
            value={timely}
            onChange={(event) => {
              if (/^\d{0,7}$/.test(event.target.value))
                setTimely(event.target.value);
            }}
          />
        </label>
      </div>
      <p id={`${id}-result`} aria-live="polite" className="missed-call-result">
        {!result
          ? "Add both counts to see your result."
          : result.status === "invalid"
            ? "Use whole counts up to 1,000,000. Within-target calls cannot exceed eligible calls."
            : result.status === "empty"
              ? "No eligible missed calls. There’s no rate to report."
              : `${result.onTime} of ${result.total} (${percent.format(result.ratio)}) got a first callback attempt within target.`}
      </p>
      <p className="fine-print">
        This is a process check, not a benchmark. It doesn’t count reached
        callers or retained clients, and it doesn’t change your grade.
      </p>
    </details>
  );
}

export default function MissedCallPlaybook({
  reports,
}: {
  reports: readonly CloudReport[];
}) {
  const [setup, setSetup] = useState(DEFAULT_CALLBACK_SETUP);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const id = useId();
  const printable = buildCallbackPlaybook(setup);
  const issued = new Map<string, string>();
  for (const report of reports) {
    if (!report.canonical || report.snapshot.isSample) continue;
    for (const action of report.snapshot.assessment.actions) {
      if (CALLBACK_ACTION_IDS.some((candidate) => candidate === action.id)) {
        if (!issued.has(action.id)) issued.set(action.id, action.title);
      }
    }
  }

  useEffect(() => {
    const reveal = () => {
      if (window.location.hash === "#missed-call-playbook") setOpen(true);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);

  function change(patch: Partial<CallbackSetup>) {
    setSetup((previous) => ({ ...previous, ...patch }));
    setNotice("");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(printable);
      setNotice("Checklist and scripts copied.");
    } catch {
      setNotice(
        "Copy isn’t available here. Open the plain-text version or download it.",
      );
    }
  }

  return (
    <section
      id="missed-call-playbook"
      className="missed-call-playbook"
      aria-labelledby={`${id}-title`}
    >
      <p className="eyebrow">PRACTICE PLAYBOOK</p>
      <h3 id={`${id}-title`}>Follow up on missed calls</h3>
      <p>
        Set a callback routine in about five minutes. Take the checklist and
        scripts to the intake tool you already use.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        {open ? "Close playbook" : "Open the missed-call playbook"}
      </button>

      <div id={`${id}-body`} className="missed-call-body" hidden={!open}>
        <fieldset className="missed-call-step">
          <legend>1. Set coverage and a callback target</legend>
          <div className="missed-call-grid">
            <div className="field-label">
              <label htmlFor={`${id}-coverage`}>Who checks the queue?</label>
              <select
                id={`${id}-coverage`}
                value={setup.coverage}
                onChange={(event) =>
                  change({
                    coverage: event.target.value === "team" ? "team" : "solo",
                  })
                }
              >
                <option value="solo">I cover callbacks in blocks</option>
                <option value="team">Designated owner and backup</option>
              </select>
            </div>
            <div className="field-label">
              <label htmlFor={`${id}-target`}>First callback target</label>
              <select
                id={`${id}-target`}
                value={setup.target}
                onChange={(event) => {
                  if (Object.hasOwn(CALLBACK_WINDOWS, event.target.value)) {
                    change({
                      target: event.target.value as CallbackSetup["target"],
                    });
                  }
                }}
              >
                {Object.entries(CALLBACK_WINDOWS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p>{callbackCoverage(setup.coverage)}</p>
          <p>
            Set your actual covered hours and time zone in your own tool.{" "}
            {CALLBACK_CLOCK} This target is your choice, not an industry
            standard.
          </p>
          <label className="missed-call-checkbox">
            <input
              type="checkbox"
              checked={setup.retry}
              onChange={(event) => change({ retry: event.target.checked })}
            />
            Allow one more safe attempt on the next covered day
          </label>
        </fieldset>

        <section className="missed-call-step" aria-labelledby={`${id}-routine`}>
          <h4 id={`${id}-routine`}>2. Run it at the next covered check</h4>
          <ol>
            <li>
              Put each genuine missed new-intake call in your existing queue.
              Merge duplicates. Route existing clients, business callers and
              spam outside this routine.
            </li>
            <li>
              Check safe contact, assign the owner and set a due time. Send
              anything at risk of missing its target to backup or the earliest
              covered callback block. Follow your firm’s procedure for urgent or
              sensitive issues.
            </li>
            <li>
              Make the first human attempt in the appropriate channel, verify
              who you reached before discussing anything private, and log the
              attempt time. {callbackStopRule(setup.retry)}
            </li>
            <li>
              Stop if reached, opted out, wrong number, unsafe to contact, or
              you’ve hit the attempt limit. If reached, move to normal intake.
            </li>
          </ol>
          <details className="missed-call-subpanel">
            <summary>See callback and voicemail wording</summary>
            <p>
              <strong>Live callback:</strong> {CALLBACK_SCRIPT}
            </p>
            <p>
              <strong>Neutral voicemail, only when safe:</strong>{" "}
              {CALLBACK_VOICEMAIL}
            </p>
            <p>
              Adapt the scripts to your firm’s policy. Don’t leave matter
              details or promise engagement, advice or timing.
            </p>
          </details>
          <div className="button-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void copy()}
            >
              Copy checklist and scripts
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                downloadTemplate(
                  "missed-call-playbook.txt",
                  printable,
                  "text/plain;charset=utf-8",
                )
              }
            >
              Download printable checklist
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                downloadTemplate(
                  "missed-call-queue-headings.csv",
                  CALLBACK_QUEUE_HEADINGS.join(",") + "\r\n",
                  "text/csv;charset=utf-8",
                )
              }
            >
              Download empty queue headings
            </button>
          </div>
          {notice && <p role="status">{notice}</p>}
          <details className="missed-call-subpanel">
            <summary>Open the printable text</summary>
            <pre>{printable}</pre>
          </details>
          <p className="fine-print">
            Keep all caller, contact and matter records in your firm’s intake
            system. The grader only gives you a template. It does not make calls
            or send messages. Setup choices clear when you leave or reload.
          </p>
        </section>

        <section className="missed-call-step" aria-labelledby={`${id}-measure`}>
          <h4 id={`${id}-measure`}>3. See if the routine is sticking</h4>
          <p>
            Use the timely first-attempt rate to see whether calls are getting a
            callback as planned. For the separate monthly business outcome, you
            can compare <strong>Inquiry → retained client</strong> if you can
            follow inquiries first received in each month through that month’s
            end. That measure covers the whole intake cohort, not just missed
            callers.
          </p>
          <CallbackSelfCheck key={setup.target} target={setup.target} />
          {issued.size > 0 ? (
            <p>
              Your saved assessments include{" "}
              {Array.from(issued.values())
                .map((title) => `“${title}”`)
                .join(" or ")}
              . If it fits your goal and you haven’t started, choose it yourself
              when setting a follow-up.
            </p>
          ) : (
            <p>
              You can try the playbook with or without a saved report. To
              register a monthly comparison, choose an action already issued in
              your own assessment if it fits what you plan to change.
            </p>
          )}
          <a className="text-link" href="#first-improvement">
            Plan a monthly follow-up
          </a>
        </section>
      </div>
    </section>
  );
}
