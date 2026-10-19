import { accountRecord, accountUuid } from "./account/validation";
import {
  LEAD_ROUTING_CONSENT_TEXT,
  LEAD_ROUTING_CONSENT_VERSION,
} from "./lead-routing";
export const HELP_TOPICS = [
  "intake",
  "cash",
  "workflow",
  "growth",
  "resilience",
  "not_sure",
] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];
export const HELP_TOPIC_LABELS: Record<HelpTopic, string> = {
  intake: "Handling inquiries",
  cash: "Pricing and collections",
  workflow: "Reducing business administration",
  growth: "Finding suitable clients",
  resilience: "Coverage and practice resilience",
  not_sure: "Choosing the right next step",
};
export const HELP_CONSENT_VERSION = LEAD_ROUTING_CONSENT_VERSION;
export const HELP_CONSENT_VERSIONS = [
  "requested-pearl-help-v1",
  HELP_CONSENT_VERSION,
] as const;
export const HELP_CONSENT_TEXT = LEAD_ROUTING_CONSENT_TEXT;
export const HELP_STATUSES = [
  "open",
  "in_review",
  "contacted",
  "closed",
  "withdrawn",
] as const;
export type HelpStatus = (typeof HELP_STATUSES)[number];
export interface HelpRequest {
  id: string;
  topic: HelpTopic;
  status: HelpStatus;
  createdAt: string;
  updatedAt: string;
  consentVersion: string;
  consentText: string;
  contactConsent: boolean;
  reportId: string | null;
  revision: number;
}
export function parseHelpInput(
  value: unknown,
): { requestId: string; topic: HelpTopic; reportId: string | null } | null {
  if (
    !accountRecord(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "requestId",
          "topic",
          "reportId",
          "consent",
          "consentVersion",
        ].includes(key),
    ) ||
    !accountUuid(value.requestId) ||
    !HELP_TOPICS.includes(value.topic as HelpTopic) ||
    value.consent !== true ||
    value.consentVersion !== HELP_CONSENT_VERSION ||
    (value.reportId !== undefined &&
      value.reportId !== null &&
      !accountUuid(value.reportId))
  )
    return null;
  return {
    requestId: value.requestId,
    topic: value.topic as HelpTopic,
    reportId: (value.reportId as string | undefined) ?? null,
  };
}
