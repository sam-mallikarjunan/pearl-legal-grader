import type { CloudReport } from "./account/types";
import { canonicalJson } from "./account/validation";
import { actionPracticeScope } from "./action-observations";
import { OUTCOME_PLAN_LIMIT, type OutcomePlan } from "./outcome-plans";
import { outcomePeriodsOverlap, type OutcomePeriod } from "./outcomes";
import {
  progressObservations,
  progressWindowKind,
  PROGRESS_METRIC_IDS,
} from "./progress-insights";

export function improvementBaselines(
  report: CloudReport,
  reports: readonly CloudReport[],
  periods: readonly OutcomePeriod[],
  now: Date,
): OutcomePeriod[] {
  if (!report.canonical || report.snapshot.isSample) return [];
  const today = now.toISOString().slice(0, 10);
  const practiceScope = canonicalJson(actionPracticeScope(report));
  return periods
    .filter((period) => {
      if (
        period.endDate >= today ||
        Date.parse(period.createdAt) > now.getTime() ||
        Date.parse(period.updatedAt) > now.getTime() ||
        progressWindowKind(period) !== "calendar_month"
      )
        return false;
      if (period.baselineReportId !== null) {
        const linked = reports.find((r) => r.id === period.baselineReportId);
        if (
          !linked ||
          !linked.canonical ||
          linked.snapshot.isSample ||
          canonicalJson(actionPracticeScope(linked)) !== practiceScope
        )
          return false;
      }
      const metrics = progressObservations(period);
      return PROGRESS_METRIC_IDS.some((key) => metrics[key].value !== null);
    })
    .sort((a, b) => b.endDate.localeCompare(a.endDate));
}

export interface ImprovementWindow {
  startDate: string;
  endDate: string;
  existingPlan: OutcomePlan | null;
}

export function improvementWindows(
  report: CloudReport,
  baseline: OutcomePeriod,
  plans: readonly OutcomePlan[],
  periods: readonly OutcomePeriod[],
  now: Date,
): ImprovementWindow[] {
  // Full UTC calendar months only. A stored period or different live plan
  // reserves that date range. A matching open plan can resume a partial save.
  const result: ImprovementWindow[] = [];
  for (let offset = 1; offset <= 12; offset++) {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
    );
    if (start.getTime() > now.getTime() + 366 * 86400000) break;
    const end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
    );
    const range = {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
    if (
      baseline.endDate >= range.startDate ||
      periods.some((p) => outcomePeriodsOverlap(p, range))
    )
      continue;

    const overlaps = plans.filter(
      (plan) =>
        plan.status !== "withdrawn" && outcomePeriodsOverlap(plan, range),
    );
    if (overlaps.length === 0) {
      const assessedAt = Date.parse(report.snapshot.createdAt);
      const savedAt = Date.parse(report.savedAt);
      if (
        assessedAt >= start.getTime() - 90 * 86400000 &&
        assessedAt <= now.getTime() &&
        savedAt <= now.getTime() &&
        plans.length < OUTCOME_PLAN_LIMIT
      )
        result.push({ ...range, existingPlan: null });
    } else if (overlaps.length === 1) {
      const plan = overlaps[0];
      if (
        plan.status === "registered" &&
        plan.outcomeId === null &&
        plan.baselineReportId === report.id &&
        plan.baselineReleaseId === report.snapshot.assessment.releaseId &&
        plan.startDate === range.startDate &&
        plan.endDate === range.endDate &&
        plan.source === baseline.source &&
        plan.currency === baseline.currency
      )
        result.push({ ...range, existingPlan: plan });
    }
  }
  return result;
}
