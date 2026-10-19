import { DEFAULT_RELEASE } from "./catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "./demo";
import { assessPractice } from "./scoring";
import type { CloudReport } from "./account/types";
import type { OutcomePlan } from "./outcome-plans";
import type { OutcomePeriod } from "./outcomes";
import { progressObservations } from "./progress-insights";
import {
  ACTION_OBSERVATION_VERSION,
  actionPracticeScope,
  type ActionObservation,
  type ActionObservationInput,
} from "./action-observations";
export const actionObservationNow = new Date("2026-10-19T17:00:00Z");
export const actionObservationUser = "939e04bb-5fc0-4558-a171-bb2c65e934f7";
export function actionObservationFixtures() {
  const report: CloudReport = {
    id: "8d0f1d4c-040d-433a-97a7-3d047c305212",
    canonical: true,
    savedAt: "2026-10-15T20:10:00Z",
    snapshot: {
      id: "13be04bb-5fc0-4558-a171-bb2c65e934f7",
      practiceId: "631a03e4-12db-4244-be83-cdf017d4c17c",
      createdAt: "2026-10-15T20:00:00Z",
      label: "Synthetic action observation",
      isSample: false,
      assessment: structuredClone(
        assessPractice({
          context: SAMPLE_CONTEXT,
          answers: SAMPLE_ANSWERS,
          controls: SAMPLE_CONTROLS,
          release: DEFAULT_RELEASE,
        }),
      ),
    },
    actionProgress: [],
  };
  const baseline: OutcomePeriod = {
    id: "7b0f1d4c-040d-433a-97a7-3d047c305212",
    revision: 0,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    source: "self_reported",
    currency: "USD",
    baselineReportId: null,
    inquiries: 100,
    contacted: 80,
    booked: 40,
    attended: 30,
    clients: 10,
    leadSpendMinor: 100000,
    cohortBilledMinor: 100000,
    cohortCollectedMinor: 80000,
    adminHours: 30,
    createdAt: "2026-10-10T12:00:00Z",
    updatedAt: "2026-10-10T12:00:00Z",
  };
  const plan: OutcomePlan = {
    id: "9b0f1d4c-040d-433a-97a7-3d047c305212",
    requestId: "9c0f1d4c-040d-433a-97a7-3d047c305212",
    revision: 0,
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    source: "self_reported",
    currency: "USD",
    baselineReportId: report.id,
    baselineReleaseId: DEFAULT_RELEASE.id,
    baselineStage: "established",
    baselineFeeModel: "mixed",
    status: "registered",
    outcomeId: null,
    createdAt: "2026-10-16T12:00:00Z",
    updatedAt: "2026-10-16T12:00:00Z",
    reportedAt: null,
    withdrawnAt: null,
  };
  const action = report.snapshot.assessment.actions[0];
  const input: ActionObservationInput = {
    requestId: "9d0f1d4c-040d-433a-97a7-3d047c305212",
    planId: plan.id,
    planRevision: 0,
    actionId: action.id,
    baselinePeriodId: baseline.id,
    baselineRevision: 0,
    metricId: "invoice_collection",
    changeStartDate: "2026-11-01",
    scopeDeclared: true,
    confounders: ["unsure"],
    version: ACTION_OBSERVATION_VERSION,
  };
  const observation: ActionObservation = {
    id: "6d0f1d4c-040d-433a-97a7-3d047c305212",
    requestId: input.requestId,
    revision: 0,
    status: "registered",
    planId: plan.id,
    reportId: report.id,
    planRevisionAtRegistration: 0,
    action: {
      id: action.id,
      title: action.title,
      definitionOfDone: action.definitionOfDone,
      verification: action.verification,
    },
    context: actionPracticeScope(report),
    window: {
      startDate: plan.startDate,
      endDate: plan.endDate,
      source: plan.source,
      currency: plan.currency,
      releaseId: plan.baselineReleaseId,
    },
    baseline: {
      id: baseline.id,
      revision: baseline.revision,
      startDate: baseline.startDate,
      endDate: baseline.endDate,
      source: baseline.source,
      currency: baseline.currency,
      baselineReportId: null,
      observation: progressObservations(baseline)[input.metricId],
    },
    metricId: input.metricId,
    changeStartDate: input.changeStartDate,
    scopeDeclared: true,
    initialConfounders: ["unsure"],
    confounders: ["unsure"],
    implementation: "unreported",
    implementationRecordedAt: null,
    version: ACTION_OBSERVATION_VERSION,
    createdAt: actionObservationNow.toISOString(),
    updatedAt: actionObservationNow.toISOString(),
    withdrawnAt: null,
  };
  const followup: OutcomePeriod = {
    ...baseline,
    id: "5d0f1d4c-040d-433a-97a7-3d047c305212",
    startDate: plan.startDate,
    endDate: plan.endDate,
    baselineReportId: report.id,
    cohortCollectedMinor: 90000,
    createdAt: "2026-12-01T12:00:00Z",
    updatedAt: "2026-12-01T12:00:00Z",
  };
  return { report, baseline, plan, input, observation, followup };
}
