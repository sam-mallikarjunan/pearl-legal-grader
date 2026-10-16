import type { ActionProgress, ActionState, SavedAssessment } from "../storage";

export const ACCOUNT_REPORT_BYTES = 250_000;
export const ACCOUNT_REPORT_LIMIT = 40;
export const ACCOUNT_CONSENT_VERSION = "account-preferences-v1";
export const ACCOUNT_CONSENT_TEXT = {
  reminders:
    "Send me reminders about my saved assessment and next actions. I can turn these off at any time.",
  marketing:
    "Send me Pearl product news and relevant offers. This is optional and does not affect my grade.",
  benchmarking:
    "Include my saved structured assessment in permissioned aggregate research. Do not publish my answers or identify my practice.",
  leaderboard:
    "Record my interest in a future optional leaderboard. This does not publish my practice, report or ranking.",
} as const;
export type AccountPreferenceKey = keyof typeof ACCOUNT_CONSENT_TEXT;
export type AccountPreferenceValues = Record<AccountPreferenceKey, boolean>;
export interface AccountPreferences {
  values: AccountPreferenceValues;
  revision: number;
  updatedAt: string | null;
  consentVersion: typeof ACCOUNT_CONSENT_VERSION;
}
export interface CloudActionProgress {
  actionId: string;
  state: ActionState;
  revision: number;
  updatedAt: string;
  details?: ActionProgress;
}
export interface CloudReport {
  id: string;
  snapshot: SavedAssessment;
  actionProgress: CloudActionProgress[];
  savedAt: string;
  canonical: true;
}
export interface AccountConsentEvent {
  preference: AccountPreferenceKey;
  granted: boolean;
  version: string;
  text: string;
  recordedAt: string;
}
export interface SaveAccountReportInput {
  report: SavedAssessment;
  actionStates: Record<string, ActionState>;
  actionProgress: Record<string, ActionProgress>;
  websiteAccess?: { scanId: string; accessToken: string };
}
export interface AccountExport {
  schema: 1;
  exportedAt: string;
  reports: CloudReport[];
  preferences: AccountPreferences;
  consentEvents: AccountConsentEvent[];
}
