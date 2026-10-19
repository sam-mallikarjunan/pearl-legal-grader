/** Fixed public vocabulary. These are analysis groups, not verified specializations. */
export const PRACTICE_BENCHMARK_VERSION = "monthly-practice-descriptives-v1";
export const PRACTICE_MAPPING_VERSION =
  "main-practice-exact-labels-preview-r1-v1";
export const PRACTICE_MAPPING_RELEASES: readonly string[] = ["preview-r1"];
export const PRACTICE_BENCHMARK_MINIMUM = 30;
export const PRACTICE_BENCHMARK_CELL_MINIMUM = 5;
export const PRACTICE_BENCHMARK_GROUPS = [
  { id: "family", label: "Family law" },
  { id: "estate", label: "Estate planning" },
  { id: "immigration", label: "Immigration" },
  { id: "criminal", label: "Criminal defense" },
  { id: "injury", label: "Personal injury" },
  { id: "business", label: "Business law" },
  { id: "employment", label: "Employment" },
  { id: "real_estate", label: "Real estate" },
  { id: "general", label: "General practice" },
] as const;
export type PracticeBenchmarkGroup =
  (typeof PRACTICE_BENCHMARK_GROUPS)[number]["id"];
export const PRACTICE_BENCHMARK_METRICS = [
  {
    id: "inquiry_client_fraction",
    label: "Inquiry-to-client conversion",
    unit: "% of that period's new-inquiry cohort",
    numerator:
      "Retained clients from inquiries first received in this calendar month, retained by month end",
    denominator: "All inquiries first received in that same calendar month",
    limitation:
      "A within-month snapshot: late-month inquiries have less follow-up time. Good fit, case mix and lead quality still matter.",
  },
  {
    id: "billed_collection_fraction",
    label: "Issued-invoice cohort collected",
    unit: "% of that month's issued invoice value",
    numerator:
      "Money collected by month end on invoices issued in this calendar month",
    denominator: "Value of invoices issued in that same calendar month",
    limitation:
      "Excludes older invoices and collections after month end. This is not total cash received or the external hourly-work collection-rate benchmark.",
  },
  {
    id: "owner_admin_hours_day",
    label: "Owner administration time",
    unit: "owner hours / calendar day",
    numerator: "The owner's administration hours during this calendar month",
    denominator: "All calendar days in that same month, including weekends",
    limitation:
      "Owner time only, not staff time. Less time is not automatically better service or greater profitability.",
  },
] as const;
export type PracticeBenchmarkMetric =
  (typeof PRACTICE_BENCHMARK_METRICS)[number]["id"];
export interface PracticeBenchmarkMetricSummary {
  id: PracticeBenchmarkMetric;
  status: "descriptive" | "withheld";
  knownWorkspacesBand: string | null;
  median: number | null;
  unit: string;
  scoreBands: {
    scoreBand: "0–49" | "50–79" | "80–100";
    knownWorkspacesBand: string;
    median: number;
  }[];
}
export interface PracticeBenchmarkCohort {
  id: string;
  group: PracticeBenchmarkGroup;
  releaseId: string;
  mappingVersion: string;
  periodStart: string;
  periodEnd: string;
  calendarDays: number;
  provenance: "preregistered" | "retrospective";
  stage: "prelaunch" | "new" | "established";
  feeModel:
    | "hourly"
    | "flat"
    | "contingency"
    | "subscription"
    | "mixed"
    | "other";
  source: "self_reported" | "export";
  currency: "USD" | "CAD" | "GBP" | "EUR" | "AUD" | "NZD" | "INR";
  workspacesBand: string;
  medianReadinessScore: number;
  metrics: PracticeBenchmarkMetricSummary[];
}
export interface PracticeBenchmarkSummary {
  status: "forming" | "descriptive" | "unavailable";
  methodologyVersion: string;
  mappingVersion: string;
  mappingSupported: boolean;
  releaseId: string | null;
  generatedAt: string;
  minimumKnownWorkspaces: number;
  minimumScoreCell: number;
  publicationEnabled: boolean;
  title: string;
  explanation: string;
  cohorts: PracticeBenchmarkCohort[];
  limitations: string[];
}
export function practiceBenchmarkGroup(
  value: unknown,
): PracticeBenchmarkGroup | null {
  // Deliberately no trim, fuzzy match, alias, website inference, or free-text echo.
  return (
    PRACTICE_BENCHMARK_GROUPS.find((group) => group.label === value)?.id ?? null
  );
}
