import { accountRecord } from "./account/validation";
import type { HelpTopic } from "./help-requests";
export const LEAD_ROUTING_CONSENT_VERSION = "requested-pearl-help-v2";
export const LEAD_ROUTING_CONSENT_TEXT =
  "I am asking Pearl to contact me at my verified account email about the selected business need. Pearl may add that email and need to its private follow-up queue. If I select a report, I also share only its readiness score, evidence coverage and rubric version. My detailed answers, website and reported outcomes are not shared. This is separate from optional marketing and does not affect my grade. I can withdraw before follow-up; contact already in progress may continue.";
export const LEAD_ROUTING_POLICY_VERSION = "private-requested-contact-v1";
export const LEAD_ROUTING_MAX_AGE_DAYS = 90;
export interface LeadReportSummary {
  score: number | null;
  coveragePercent: number;
  rubricVersion: string;
}
export interface RequestedContactDetail {
  requestId: string;
  verifiedEmail: string;
  topic: HelpTopic;
  consentVersion: typeof LEAD_ROUTING_CONSENT_VERSION;
  consentText: typeof LEAD_ROUTING_CONSENT_TEXT;
  reportSummary: LeadReportSummary | null;
  emailVerificationNote: string;
}
export function validRoutingEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)
  );
}
export function safeRoutingSummary(value: unknown): LeadReportSummary | null {
  if (
    !accountRecord(value) ||
    !(
      value.score === null ||
      (typeof value.score === "number" &&
        Number.isFinite(value.score) &&
        value.score >= 0 &&
        value.score <= 100)
    ) ||
    typeof value.coveragePercent !== "number" ||
    !Number.isFinite(value.coveragePercent) ||
    value.coveragePercent < 0 ||
    value.coveragePercent > 100 ||
    typeof value.rubricVersion !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(value.rubricVersion)
  )
    return null;
  return {
    score: value.score === null ? null : Math.round(value.score),
    coveragePercent: Math.round(value.coveragePercent),
    rubricVersion: value.rubricVersion,
  };
}
