export const PILOT_COHORT = "first-improvement-v1";
export const PILOT_LINK = `/account?pilot=${PILOT_COHORT}#first-improvement-pilot`;
export const PILOT_CAPACITY = 10;
export const PILOT_MINIMUM_DETAIL = 5;

export const PILOT_USEFULNESS = {
  useful: "Yes, I found a next step worth trying",
  not_yet: "Not yet",
  unsure: "I'm not sure yet",
} as const;

export const PILOT_BLOCKERS = {
  finding_action: "Finding an action that fits",
  finding_baseline: "Getting baseline numbers",
  choosing_measure: "Choosing what to measure",
  making_time: "Making time to act",
  reporting_followup: "Reporting the follow-up month",
  other: "Something else",
  none: "Nothing right now",
} as const;

export type PilotUsefulness = keyof typeof PILOT_USEFULNESS;
export type PilotBlocker = keyof typeof PILOT_BLOCKERS;

export interface PilotParticipation {
  cohort: typeof PILOT_COHORT;
  joinedAt: string;
  revision: number;
  usefulness: PilotUsefulness | null;
  blocker: PilotBlocker | null;
  firstUsefulAt: string | null;
  feedbackUpdatedAt: string | null;
}

export interface PilotSummaryDetails {
  reportsAvailable: number;
  reportsSavedSinceJoining: number;
  savedReportAndActionChosen: number;
  newPlans: number;
  eligibleTracking: number;
  elapsedWindows: number;
  exactFollowups: number;
  comparableFollowups: number;
  usefulnessResponses: number;
  usefulResponses: number;
  medianMinutesToUseful: number | null;
  blockerResponses: number;
  commonBlockers: Partial<Record<PilotBlocker, number>>;
  helpRequests: number;
}

export interface PilotSummary {
  cohort: typeof PILOT_COHORT;
  capacity: typeof PILOT_CAPACITY;
  minimumForDetail: typeof PILOT_MINIMUM_DETAIL;
  enrolled: number;
  details: PilotSummaryDetails | null;
}
