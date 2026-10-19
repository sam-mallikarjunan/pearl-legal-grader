import type { CloudActionProgress, CloudReport } from "./account/types";
import type { OutcomePeriod } from "./outcomes";
import {
  getLatestComparableChange,
  buildProgressInsights,
  type LatestComparableChange,
} from "./progress-insights";
import type { Goal, PrioritizedAction } from "./types";
export const PERSONALIZATION_GOALS: ReadonlyArray<{
  value: Goal;
  label: string;
}> = [
  { value: "more_clients", label: "Suitable new clients" },
  { value: "better_conversion", label: "A clearer intake path" },
  { value: "collect_cash", label: "Pricing and cash collection" },
  { value: "less_admin", label: "Less business administration" },
  { value: "sustainable_practice", label: "Sustainable capacity and coverage" },
];
export interface IssuedNextStep {
  kind: "issued";
  action: PrioritizedAction;
  progress: CloudActionProgress;
  whyNow: string[];
  measure: string;
  essential: boolean;
}
export interface MeasurementNextStep {
  kind: "measurement";
  title: string;
  whyNow: string[];
  measure: string;
  href: "/account#business-outcomes";
}
export type PersonalizedNextStep = IssuedNextStep | MeasurementNextStep;
export interface PersonalizedActionsResult {
  reportId: string;
  reportDate: string;
  rubricVersion: string;
  goal: Goal;
  items: PersonalizedNextStep[];
  excluded: {
    done: number;
    deferred: number;
    notRelevant: number;
    capacity: number;
  };
  note: string;
}
const goals = new Set(PERSONALIZATION_GOALS.map((g) => g.value));
function currentPeriod(periods: OutcomePeriod[]) {
  return [...periods].sort(
    (a, b) =>
      b.endDate.localeCompare(a.endDate) ||
      b.startDate.localeCompare(a.startDate) ||
      a.id.localeCompare(b.id),
  )[0];
}
function signal(
  action: PrioritizedAction,
  change: LatestComparableChange | null,
  goal: Goal,
) {
  if (!change) return null;
  const m = change.metrics.find(
    (m) =>
      m.reason === null &&
      [
        m.delta,
        m.current,
        m.previous,
        m.currentNumerator,
        m.currentDenominator,
        m.previousNumerator,
        m.previousDenominator,
      ].every((v) => typeof v === "number" && Number.isFinite(v)) &&
      m.currentDenominator! > 0 &&
      m.previousDenominator! > 0 &&
      ((m.id === "inquiry_conversion" &&
        m.delta! < 0 &&
        ["intake", "service"].includes(action.domain) &&
        ["more_clients", "better_conversion"].includes(goal)) ||
        (m.id === "invoice_collection" &&
          m.delta! < 0 &&
          action.domain === "cash" &&
          goal === "collect_cash") ||
        (m.id === "cost_per_client" &&
          m.delta! > 0 &&
          ["presence", "intake"].includes(action.domain) &&
          ["more_clients", "better_conversion"].includes(goal)) ||
        (m.id === "owner_admin_hours_day" &&
          m.delta! > 0 &&
          ["operations", "independence"].includes(action.domain) &&
          ["less_admin", "sustainable_practice"].includes(goal))),
  );
  if (!m) return null;
  const label = {
    inquiry_conversion: "Inquiries becoming clients",
    invoice_collection: "Period-issued invoices collected by period end",
    cost_per_client: "Acquisition spend per accepted engagement",
    owner_admin_hours_day: "Your administration hours per calendar day",
  }[m.id];
  const value = (n: number) =>
    m.unit === "percentage_points"
      ? `${n.toFixed(1)}%`
      : m.unit === "minor_currency_per_client"
        ? `${(n / 100).toFixed(2)} ${change.currency}`
        : `${n.toFixed(2)} hours/day`;
  return `${label}: ${value(m.previous!)} (${m.previousNumerator}/${m.previousDenominator}) in ${change.previousStart}–${change.previousEnd}; ${value(m.current!)} (${m.currentNumerator}/${m.currentDenominator}) in ${change.currentStart}–${change.currentEnd}. Source: ${change.source === "export" ? "owner-supplied export totals" : "owner-entered totals"}; currency ${change.currency}. These owner observations suggest a review, not a cause or a finding of failure.`;
}
/** Selection reorders only the selected report's issued actions; grades/templates are never recalculated. */
export function getPersonalizedActions(
  report: CloudReport,
  options: {
    goal?: Goal;
    periods?: OutcomePeriod[];
    allowUnlinkedForSelectedPractice?: boolean;
    now?: Date;
  } = {},
): PersonalizedActionsResult {
  const assessment = report.snapshot.assessment,
    goal =
      options.goal && goals.has(options.goal)
        ? options.goal
        : assessment.contextSnapshot.goal;
  const result: PersonalizedActionsResult = {
    reportId: report.id,
    reportDate: report.snapshot.createdAt,
    rubricVersion: assessment.releaseId,
    goal,
    items: [],
    excluded: { done: 0, deferred: 0, notRelevant: 0, capacity: 0 },
    note: "Personalized ordering only. Your issued report, grade and templates stay unchanged. Progress and business observations are owner-reported and do not establish compliance, causation or guaranteed savings.",
  };
  if (
    report.canonical !== true ||
    report.snapshot.isSample ||
    !Array.isArray(assessment.actions) ||
    !Array.isArray(report.actionProgress)
  )
    return result;
  const allPeriods = options.periods || [],
    scopedPeriods = allPeriods.filter(
      (p) =>
        p.baselineReportId === report.id ||
        (options.allowUnlinkedForSelectedPractice === true &&
          p.baselineReportId === null),
    ),
    periods = buildProgressInsights(
      scopedPeriods,
      undefined,
      undefined,
      [report],
      options.now || new Date(),
    ).periods,
    latest = currentPeriod(periods),
    now = (options.now || new Date()).toISOString().slice(0, 10),
    capacity = assessment.contextSnapshot.capacityAdditionalMatters,
    capacityFull = capacity !== null && capacity <= 0;
  const usableChange = getLatestComparableChange(
    periods,
    [report],
    options.now || new Date(),
  );
  const unlinkedScope =
    usableChange &&
    periods.find((p) => p.id === usableChange.currentId)?.baselineReportId ===
      null;
  const seen = new Set<string>();
  const ranked: Array<{ item: IssuedNextStep; tier: number; index: number }> =
    [];
  assessment.actions.forEach((action, index) => {
    if (
      seen.has(action.id) ||
      !assessment.releaseSnapshot.actions.some((a) => a.id === action.id)
    )
      return;
    seen.add(action.id);
    const progress = report.actionProgress.find(
      (p) => p.actionId === action.id,
    );
    if (!progress) return;
    if (progress.state === "done") {
      result.excluded.done++;
      return;
    }
    if (progress.state === "deferred") {
      result.excluded.deferred++;
      return;
    }
    if (progress.state === "not_relevant") {
      result.excluded.notRelevant++;
      return;
    }
    const growth =
      action.requiresCapacity ||
      (action.domain === "presence" && action.goalFit.includes("more_clients"));
    if (
      (capacityFull && growth) ||
      (action.requiresCapacity && (capacity === null || capacity <= 0))
    ) {
      result.excluded.capacity++;
      return;
    }
    const control =
      action.trigger.type === "control"
        ? assessment.controls.find(
            (c) => c.id === (action.trigger as { controlId: string }).controlId,
          )
        : null;
    const essential = control?.applicable === true && control.status === "no",
      unknownControl =
        control?.applicable === true && control.status === "unknown";
    const overdue =
      !!progress.details?.targetDate && progress.details.targetDate < now;
    const explanation = signal(action, usableChange, goal),
      whyNow: string[] = [];
    if (essential)
      whyNow.push(
        `You explicitly reported ${control!.title.toLowerCase()} as missing in the report dated ${report.snapshot.createdAt.slice(0, 10)}. Review the actual arrangement with appropriate qualified help; this is separate from the grade.`,
      );
    else if (unknownControl)
      whyNow.push(
        `The working arrangement for ${control!.title.toLowerCase()} was unknown in the selected report. Confirm it first; unknown does not establish a missing control.`,
      );
    if (overdue)
      whyNow.push(
        `Your own target date (${progress.details!.targetDate}) has passed. This is a planning cue, not proof the action failed.`,
      );
    if (progress.state === "in_progress")
      whyNow.push(
        "You already started this action. Continue or review that commitment before adding new work.",
      );
    if (action.trigger.type === "capacity_full")
      whyNow.push(
        "The selected report says there is no spare matter capacity. Review existing work and acceptance choices before seeking more demand.",
      );
    if (explanation) {
      whyNow.push(explanation);
      if (unlinkedScope)
        whyNow.push(
          "You chose to use two unlinked business periods for this selected practice. Their practice match is owner-declared and has not been independently verified; no baseline link or research permission was changed.",
        );
    }
    if (action.goalFit.includes(goal))
      whyNow.push(
        `This issued action fits your selected focus: ${PERSONALIZATION_GOALS.find((g) => g.value === goal)!.label.toLowerCase()}.`,
      );
    if (!whyNow.length)
      whyNow.push(
        `This action was issued with the selected report (${report.snapshot.createdAt.slice(0, 10)}) at ${action.priority} priority. Its original template and evidence remain the source.`,
      );
    const tier = essential
      ? 0
      : overdue
        ? 1
        : progress.state === "in_progress"
          ? 2
          : action.trigger.type === "capacity_full"
            ? 3
            : explanation
              ? 4
              : action.goalFit.includes(goal)
                ? 5
                : action.priority === "high"
                  ? 6
                  : action.priority === "medium"
                    ? 7
                    : 8;
    ranked.push({
      item: {
        kind: "issued",
        action,
        progress,
        essential,
        whyNow,
        measure: `Completion definition: ${action.definitionOfDone} Measurement: ${action.verification}`,
      },
      tier,
      index,
    });
  });
  ranked.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.index - b.index ||
      a.item.action.id.localeCompare(b.item.action.id),
  );
  let measurement: MeasurementNextStep | null = null;
  const missing = latest
    ? goal === "collect_cash"
      ? latest.cohortBilledMinor === null ||
        latest.cohortCollectedMinor === null
      : goal === "more_clients" || goal === "better_conversion"
        ? latest.inquiries === null || latest.clients === null
        : latest.adminHours === null
    : true;
  if (!latest)
    measurement = {
      kind: "measurement",
      title: "Record a small, clearly defined business period",
      whyNow: [
        allPeriods.some((p) => p.baselineReportId === null) &&
        !options.allowUnlinkedForSelectedPractice
          ? "Your unlinked periods are not being used for this practice. Confirm their practice scope above if appropriate; this does not change their saved baseline or research permission."
          : "No saved outcome period linked to this selected report is available. That means the result is unknown, not that the practice is failing.",
      ],
      measure:
        "Record known aggregate measures from one closed period. Keep inquiry counts, invoice collections and owner time in their defined cohorts; leave other values blank.",
      href: "/account#business-outcomes",
    };
  else if (missing)
    measurement = {
      kind: "measurement",
      title: "Fill one measurement gap from your own records",
      whyNow: [
        `The latest saved period (${latest.startDate}–${latest.endDate}, ${latest.currency}, ${latest.source}) has an unknown measure relevant to your focus. Unknown remains unknown.`,
      ],
      measure:
        "Use your records or the reviewed import preview to add the missing numerator and denominator for the same cohort. Do not replace an unknown with zero or combine periods.",
      href: "/account#business-outcomes",
    };
  else if (!usableChange)
    measurement = {
      kind: "measurement",
      title: "Build a comparable follow-up before drawing a conclusion",
      whyNow: [
        `Your latest period is ${latest.startDate}–${latest.endDate}. A comparable pair for this selected report or your explicitly confirmed unlinked practice periods is not available; a different baseline or unmatched period is not interchangeable.`,
      ],
      measure:
        "Review the source, currency, period length and baseline, then register a future reporting month if useful. Keep any observed change separate from claims about what caused it.",
      href: "/account#business-outcomes",
    };
  const protectedCount = ranked.filter((r) => r.tier <= 2).length;
  const actionLimit = measurement && protectedCount < 3 ? 2 : 3;
  result.items = ranked.slice(0, actionLimit).map((r) => r.item);
  if (measurement && result.items.length < 3) result.items.push(measurement);
  return result;
}
