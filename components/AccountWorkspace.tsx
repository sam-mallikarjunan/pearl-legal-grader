"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { CloudReport } from "../lib/account/types";
import {
  decodeActionObservation,
  type ActionObservation,
} from "../lib/action-observations";
import { decodeOutcomePlan, type OutcomePlan } from "../lib/outcome-plans";
import GuidedTour from "./GuidedTour";
import "./account-workspace.css";

type WorkspaceAreaName =
  | "overview"
  | "action"
  | "review"
  | "data"
  | "learning"
  | "settings";
const areas: Array<{
  name: WorkspaceAreaName;
  title: string;
  target: string;
  targets: string[];
}> = [
  {
    name: "overview",
    title: "My next step",
    target: "workspace-overview",
    targets: ["workspace-overview"],
  },
  {
    name: "action",
    title: "My action",
    target: "personalized-next-actions",
    targets: [
      "personalized-next-actions",
      "first-improvement",
      "missed-call-playbook",
      "action-outcome-tracking",
    ],
  },
  {
    name: "review",
    title: "Review progress",
    target: "monthly-practice-brief",
    targets: [
      "monthly-practice-brief",
      "private-progress",
      "outcome-plans",
      "outcome-reporting-reminders",
    ],
  },
  {
    name: "data",
    title: "Reports & numbers",
    target: "saved-account-reports",
    targets: [
      "saved-account-reports",
      "business-outcomes",
      "import-business-outcomes",
      "data-integrations",
    ],
  },
  {
    name: "learning",
    title: "Learning & community",
    target: "practice-learning",
    targets: [
      "practice-learning",
      "first-improvement-pilot",
      "readiness-leaderboard",
    ],
  },
  {
    name: "settings",
    title: "Settings & help",
    target: "account-choices",
    targets: ["account-choices", "request-help", "account-data"],
  },
];
const navigationEvent = "grader:workspace-navigation";
const workspaceTourSteps = [
  {
    id: "next-step",
    target:
      '[data-tour="workspace-overview-nav"], [data-tour="workspace-section-select"]',
    title: "Start with one useful next step",
    body: "My next step points you toward the next useful action, report, or check-in. Start there when you return; you can explore the other tools when you need them.",
  },
  {
    id: "my-action",
    target:
      '[data-tour="workspace-action-nav"], [data-tour="workspace-section-select"]',
    title: "Put your action into practice",
    body: "My action holds your prioritized checklist and the missed-call playbook. Record what you tried and how it went. Completing an action does not automatically raise your grade.",
  },
  {
    id: "review-progress",
    target:
      '[data-tour="workspace-review-nav"], [data-tour="workspace-section-select"]',
    title: "Return to review what changed",
    body: "Review progress brings together your Monthly Practice Brief, comparisons, and optional reminders. A monthly comparison needs compatible figures; a readiness score alone cannot prove business improvement.",
  },
  {
    id: "reports-and-numbers",
    target:
      '[data-tour="workspace-data-nav"], [data-tour="workspace-section-select"]',
    title: "Keep reports and figures together",
    body: "Reports & numbers holds the reports you chose to save, business totals, and optional import tools. Opening a saved report on a device does not upload that device’s other history.",
  },
  {
    id: "settings-and-help",
    target:
      '[data-tour="workspace-settings-nav"], [data-tour="workspace-section-select"]',
    title: "Keep control of your choices",
    body: "Settings & help is where you manage sharing choices, export your data, or ask Pearl for help. Lessons and the opt-in leaderboard live in Learning & community. This tour changes none of those choices.",
  },
];
const WorkspaceContext = createContext<{
  active: WorkspaceAreaName;
  visited: WorkspaceAreaName[];
} | null>(null);

export function AccountWorkspace({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  const navigationId = useId();
  const [active, setActive] = useState<WorkspaceAreaName>(
    compact ? "data" : "overview",
  );
  const [visited, setVisited] = useState<WorkspaceAreaName[]>(
    compact ? ["data"] : ["overview"],
  );
  const reveal = useCallback((target: string, moveFocus = true) => {
    target = target || "workspace-overview";
    const area = areas.find((item) => item.targets.includes(target));
    if (!area) return;
    setActive(area.name);
    setVisited((current) =>
      current.includes(area.name) ? current : [...current, area.name],
    );
    window.dispatchEvent(
      new CustomEvent(navigationEvent, { detail: { target } }),
    );
    if (moveFocus) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const element = document.getElementById(target);
          if (!element) return;
          element.tabIndex = -1;
          element.focus({ preventScroll: true });
          element.scrollIntoView({ block: "start" });
        }),
      );
    }
  }, []);

  useEffect(() => {
    if (compact) return;
    reveal(window.location.hash.slice(1), false);
    const onHash = () => reveal(window.location.hash.slice(1));
    const onBrief = () => reveal("monthly-practice-brief", false);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("grader:monthly-brief-open", onBrief);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("grader:monthly-brief-open", onBrief);
    };
  }, [compact, reveal]);

  function followLink(event: MouseEvent<HTMLDivElement>) {
    if (
      compact ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    const target = (event.target as Element).closest<HTMLAnchorElement>(
      'a[href^="#"]',
    );
    if (target) reveal(target.hash.slice(1));
  }

  return (
    <WorkspaceContext.Provider value={{ active, visited }}>
      <div className="account-workspace" onClickCapture={followLink}>
        {!compact && (
          <nav
            className="workspace-navigation"
            aria-label="Your workspace"
            data-tour="workspace-navigation"
          >
            <div className="workspace-mobile-navigation">
              <label htmlFor={navigationId}>Workspace section</label>
              <select
                id={navigationId}
                data-tour="workspace-section-select"
                value={active}
                onChange={(event) => {
                  const area = areas.find(
                    (item) => item.name === event.target.value,
                  );
                  if (!area) return;
                  window.location.hash = area.target;
                  reveal(area.target);
                }}
              >
                {areas.map((area) => (
                  <option key={area.name} value={area.name}>
                    {area.title}
                  </option>
                ))}
              </select>
            </div>
            {areas.map((area) => (
              <a
                key={area.name}
                href={`#${area.target}`}
                data-tour={`workspace-${area.name}-nav`}
                aria-current={active === area.name ? "page" : undefined}
              >
                {area.title}
              </a>
            ))}
          </nav>
        )}
        {!compact && (
          <GuidedTour
            key={active}
            tourId="workspace"
            title="Find your way around your workspace"
            description="Take a short tour, then choose the next step that fits your practice."
            steps={workspaceTourSteps}
            autoOffer={active === "overview"}
          />
        )}
        {children}
      </div>
    </WorkspaceContext.Provider>
  );
}

export function WorkspaceArea({
  area,
  children,
  eager = false,
}: {
  area: WorkspaceAreaName;
  children: ReactNode;
  eager?: boolean;
}) {
  const workspace = useContext(WorkspaceContext);
  if (!workspace || (!eager && !workspace.visited.includes(area))) return null;
  return (
    <div className="workspace-area" hidden={workspace.active !== area}>
      {children}
    </div>
  );
}

/** Open advanced tools when their existing deep link is followed, and retain drafts after the first visit. */
export function WorkspaceTool({
  target,
  title,
  children,
}: {
  target: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  useEffect(() => {
    const reveal = (event?: Event) => {
      const requested =
        event instanceof CustomEvent
          ? event.detail?.target
          : window.location.hash.slice(1);
      if (requested === target) {
        setOpen(true);
        setVisited(true);
      }
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    window.addEventListener(navigationEvent, reveal);
    return () => {
      window.removeEventListener("hashchange", reveal);
      window.removeEventListener(navigationEvent, reveal);
    };
  }, [target]);
  return (
    <details
      className="workspace-tool"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        if (next) setVisited(true);
      }}
    >
      <summary>{title}</summary>
      {visited && <div className="workspace-tool-body">{children}</div>}
    </details>
  );
}

type TrackedAction = { observation: ActionObservation; status: string };
const comparisonStatuses = [
  "withdrawn",
  "plan_unavailable",
  "baseline_changed",
  "waiting",
  "unreported",
  "unknown",
  "descriptive",
];
const dateLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
function dayAfter(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000)
    .toISOString()
    .slice(0, 10);
}

export function WorkspaceOverview({ reports }: { reports: CloudReport[] }) {
  const id = useId();
  const [tracking, setTracking] = useState<TrackedAction[]>([]);
  const [plans, setPlans] = useState<OutcomePlan[]>([]);
  const [loading, setLoading] = useState(reports.length > 0);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (reports.length === 0) {
      setTracking([]);
      setPlans([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const changed = () => setReload((n) => n + 1);
    const changes = [
      "grader:outcome-plans-changed",
      "grader:outcomes-changed",
      "grader:action-observations-changed",
    ];
    changes.forEach((name) => window.addEventListener(name, changed));
    setLoading(true);
    async function load() {
      try {
        const [a, p] = await Promise.all([
          fetch("/api/account/action-observations", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/api/account/outcome-plans", {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        const observations = await a.json(),
          periods = await p.json();
        if (
          !a.ok ||
          !p.ok ||
          !Array.isArray(observations.views) ||
          !Array.isArray(periods.plans)
        )
          throw new Error();
        const nextTracking = observations.views.map(
          (view: unknown): TrackedAction => {
            const value = view as {
              observation?: unknown;
              comparison?: { status?: string };
            };
            if (
              !value ||
              !comparisonStatuses.includes(value.comparison?.status ?? "")
            )
              throw new Error();
            return {
              observation: decodeActionObservation(value.observation),
              status: value.comparison!.status!,
            };
          },
        );
        if (controller.signal.aborted) return;
        setTracking(nextTracking);
        setPlans(periods.plans.map(decodeOutcomePlan));
        setError("");
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Your saved plan status could not load. You can still open your action or refresh here.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
      changes.forEach((name) => window.removeEventListener(name, changed));
    };
  }, [reload, reports]);

  const report = reports[0];
  const unfinished =
    report?.snapshot.assessment.actions.find(
      (action) =>
        report.actionProgress.find((p) => p.actionId === action.id)?.state ===
        "in_progress",
    ) ??
    report?.snapshot.assessment.actions.find(
      (action) =>
        !["done", "not_relevant", "deferred"].includes(
          report.actionProgress.find((p) => p.actionId === action.id)?.state ??
            "todo",
        ),
    );
  const tracked = tracking
    .filter(
      (entry) =>
        entry.observation.status === "registered" &&
        entry.status !== "plan_unavailable" &&
        entry.observation.context.practiceId === report?.snapshot.practiceId &&
        reports.some(
          (source) =>
            source.id === entry.observation.reportId &&
            source.snapshot.practiceId === report?.snapshot.practiceId,
        ),
    )
    .sort((a, b) =>
      b.observation.createdAt.localeCompare(a.observation.createdAt),
    )[0];
  const sourceReport = tracked
    ? reports.find((source) => source.id === tracked.observation.reportId)!
    : report;
  const plan = plans
    .filter(
      (plan) =>
        plan.status === "registered" &&
        reports.some(
          (source) =>
            source.id === plan.baselineReportId &&
            source.snapshot.practiceId === report?.snapshot.practiceId,
        ),
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const today = new Date().toISOString().slice(0, 10);
  const due =
    tracked?.status === "unreported" ||
    (!tracked && plan && plan.endDate < today);
  const review =
    tracked &&
    ["descriptive", "unknown", "baseline_changed"].includes(tracked.status);
  const title = due
    ? "Your follow-up month is ready to report"
    : review
      ? "Review what changed"
      : report
        ? "One useful action to work on"
        : "Find your first useful action";
  const target = due
    ? "#business-outcomes"
    : review
      ? "#monthly-practice-brief"
      : tracked
        ? "#action-outcome-tracking"
        : unfinished
          ? "#personalized-next-actions"
          : report
            ? "#saved-account-reports"
            : "/";
  const label = due
    ? "Add the month's figures"
    : review
      ? "Open my monthly brief"
      : tracked
        ? "Review my action and check in"
        : unfinished
          ? "Open my action checklist"
          : report
            ? "Review my saved report"
            : "Start my assessment";
  const actionProgress = sourceReport?.actionProgress.find(
    (progress) =>
      progress.actionId === (tracked?.observation.action.id ?? unfinished?.id),
  );
  const targetDate = actionProgress?.details?.targetDate;
  const checkInBase =
    actionProgress?.state === "in_progress"
      ? (actionProgress.details?.updatedAt ?? actionProgress.updatedAt)
      : sourceReport?.savedAt;
  const suggestedCheckIn =
    checkInBase && (tracked || unfinished)
      ? new Date(Date.parse(checkInBase) + 7 * 86400000)
          .toISOString()
          .slice(0, 10)
      : null;

  return (
    <section
      id="workspace-overview"
      className="workspace-overview"
      aria-labelledby={`${id}-title`}
    >
      <p className="eyebrow">YOUR NEXT STEP</p>
      <h2 id={`${id}-title`}>{title}</h2>
      {report ? (
        <>
          <h3>
            {tracked?.observation.action.title ??
              unfinished?.title ??
              "Choose what to work on next"}
          </h3>
          <p>
            {due
              ? "Use the dates and counting rules from your registration when you add this month's known totals."
              : review
                ? "Compare the recorded periods, review other factors, and decide what to do next."
                : tracked
                  ? "Record how the change is going and what else has changed in your practice."
                  : unfinished
                    ? unfinished.summary
                    : "Open your latest report to review your progress and choose a new focus."}
          </p>
          <p className="fine-print">
            {tracked ? "Action source report" : "Latest saved report"} ·{" "}
            {sourceReport.snapshot.label} ·{" "}
            {dateLabel(sourceReport.snapshot.createdAt.slice(0, 10))}
          </p>
        </>
      ) : (
        <p>
          Answer a short set of questions, choose one next action, and save its
          report here when you want to return from another device.
        </p>
      )}
      <div className="button-row">
        <a
          className="btn btn-primary"
          href={target}
          onClick={() => {
            if (review && tracked)
              window.dispatchEvent(
                new CustomEvent("grader:monthly-brief-open", {
                  detail: { observationId: tracked.observation.id },
                }),
              );
          }}
        >
          {label}
        </a>
        {report && (
          <a className="text-link" href="#saved-account-reports">
            My saved reports
          </a>
        )}
      </div>
      {tracked && (
        <p className="workspace-review-date">
          Monthly review opens{" "}
          {dateLabel(dayAfter(tracked.observation.window.endDate))} ·{" "}
          {tracked.observation.window.startDate} to{" "}
          {tracked.observation.window.endDate} (UTC)
        </p>
      )}
      {!tracked && plan && (
        <p className="workspace-review-date">
          Planned review opens {dateLabel(dayAfter(plan.endDate))} ·{" "}
          {plan.startDate} to {plan.endDate} (UTC)
        </p>
      )}
      {targetDate && (
        <p className="workspace-review-date">
          Your action target · {dateLabel(targetDate)}
        </p>
      )}
      {suggestedCheckIn && (
        <p className="fine-print">
          Suggested check-in · {dateLabel(suggestedCheckIn)}. Open your action
          to record how it is going.
        </p>
      )}
      {report && !tracked && !targetDate && (
        <p className="fine-print">
          You can use the action checklist today and plan a monthly comparison
          when you have baseline figures.
        </p>
      )}
      <div className="workspace-shortcuts">
        <a href="#missed-call-playbook">
          Use the missed-call follow-up playbook
        </a>
        {report && (
          <a href="#first-improvement">Plan an optional monthly comparison</a>
        )}
      </div>
      {loading && (
        <p role="status" className="fine-print">
          Checking your saved plan…
        </p>
      )}
      {error && (
        <p role="status" className="fine-print">
          {error}{" "}
          <button className="text-link" onClick={() => setReload((n) => n + 1)}>
            Refresh plan status
          </button>
        </p>
      )}
    </section>
  );
}
