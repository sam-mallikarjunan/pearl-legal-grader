/** Owner-supplied aggregate outcomes are observations, never a change to an issued grade. */
export const OUTCOME_RESEARCH_VERSION = "outcome-research-consent-v1";
export const OUTCOME_RESEARCH_TEXT =
  "Include my saved aggregate business periods and linked practice assessments in permissioned research to evaluate and improve Pearl’s benchmarks and scoring. This is separate from assessment benchmarking, marketing and leaderboard permissions. Do not publish my raw periods, answers or identity. I can withdraw this permission at any time; already published anonymous aggregates cannot identify or remove a past contribution.";
export const OUTCOME_SOURCES = ["self_reported", "export"] as const;
export const OUTCOME_CURRENCIES = [
  "USD",
  "CAD",
  "GBP",
  "EUR",
  "AUD",
  "NZD",
  "INR",
] as const;
export const OUTCOME_COUNT_FIELDS = [
  "inquiries",
  "contacted",
  "booked",
  "attended",
  "clients",
] as const;
export const OUTCOME_MONEY_FIELDS = [
  "leadSpendMinor",
  "cohortBilledMinor",
  "cohortCollectedMinor",
] as const;
export const OUTCOME_LIMITS = {
  periods: 24,
  minDays: 7,
  maxDays: 366,
  count: 1_000_000,
  moneyMinor: 10_000_000_000,
  revision: 1_000_000,
  events: 2000,
} as const;
export type OutcomeCountField = (typeof OUTCOME_COUNT_FIELDS)[number];
export type OutcomeMoneyField = (typeof OUTCOME_MONEY_FIELDS)[number];
export interface OutcomePeriodInput {
  startDate: string;
  endDate: string;
  source: (typeof OUTCOME_SOURCES)[number];
  currency: (typeof OUTCOME_CURRENCIES)[number];
  baselineReportId: string | null;
  inquiries: number | null;
  contacted: number | null;
  booked: number | null;
  attended: number | null;
  clients: number | null;
  leadSpendMinor: number | null;
  cohortBilledMinor: number | null;
  cohortCollectedMinor: number | null;
  adminHours: number | null;
}
export interface OutcomePeriod extends OutcomePeriodInput {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface OutcomeResearchConsent {
  granted: boolean;
  revision: number;
  version: typeof OUTCOME_RESEARCH_VERSION;
  updatedAt: string | null;
}
export interface OutcomeAccountState {
  periods: OutcomePeriod[];
  consent: OutcomeResearchConsent;
}
export class OutcomeInputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "OutcomeInputError";
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const dateValue = (value: unknown): number | null => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "1970-01-01"
  )
    return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
    ? d.getTime()
    : null;
};
export function outcomePeriodDays(startDate: string, endDate: string): number {
  const start = dateValue(startDate),
    end = dateValue(endDate);
  return start === null || end === null ? NaN : (end - start) / 86400000 + 1;
}
const allowedKeys = [
  "startDate",
  "endDate",
  "source",
  "currency",
  "baselineReportId",
  ...OUTCOME_COUNT_FIELDS,
  ...OUTCOME_MONEY_FIELDS,
  "adminHours",
];
export function parseOutcomePeriodInput(
  value: unknown,
  now = new Date(),
): OutcomePeriodInput {
  if (
    !record(value) ||
    Object.keys(value).some((k) => !allowedKeys.includes(k))
  )
    throw new OutcomeInputError(
      "invalid_outcome",
      "Use aggregate period fields only. Do not include client, matter or free-text details.",
    );
  const days = outcomePeriodDays(
    String(value.startDate),
    String(value.endDate),
  );
  if (
    !Number.isInteger(days) ||
    days < OUTCOME_LIMITS.minDays ||
    days > OUTCOME_LIMITS.maxDays ||
    String(value.endDate) >= now.toISOString().slice(0, 10)
  )
    throw new OutcomeInputError(
      "invalid_outcome_dates",
      "Choose a closed period of 7–366 days ending before today.",
    );
  if (
    !OUTCOME_SOURCES.includes(value.source as never) ||
    !OUTCOME_CURRENCIES.includes(value.currency as never)
  )
    throw new OutcomeInputError(
      "invalid_outcome_source",
      "Choose the source and one currency for this whole period.",
    );
  if (
    value.baselineReportId !== undefined &&
    value.baselineReportId !== null &&
    !uuid(value.baselineReportId)
  )
    throw new OutcomeInputError(
      "invalid_outcome_baseline",
      "Choose a saved baseline report from your account, or leave it unlinked.",
    );
  const result: OutcomePeriodInput = {
    startDate: value.startDate as string,
    endDate: value.endDate as string,
    source: value.source as OutcomePeriodInput["source"],
    currency: value.currency as OutcomePeriodInput["currency"],
    baselineReportId: (value.baselineReportId as string | null) || null,
    inquiries: null,
    contacted: null,
    booked: null,
    attended: null,
    clients: null,
    leadSpendMinor: null,
    cohortBilledMinor: null,
    cohortCollectedMinor: null,
    adminHours: null,
  };
  for (const field of [...OUTCOME_COUNT_FIELDS, ...OUTCOME_MONEY_FIELDS]) {
    const n = value[field];
    if (n === undefined || n === null) continue;
    if (
      typeof n !== "number" ||
      !Number.isSafeInteger(n) ||
      n < 0 ||
      n >
        (OUTCOME_COUNT_FIELDS.includes(field as OutcomeCountField)
          ? OUTCOME_LIMITS.count
          : OUTCOME_LIMITS.moneyMinor)
    )
      throw new OutcomeInputError(
        "invalid_outcome_number",
        "Use bounded, non-negative whole counts or money in minor units. Leave unknown values blank.",
      );
    result[field] = n;
  }
  let previous: number | null = null;
  for (const field of OUTCOME_COUNT_FIELDS) {
    const n = result[field];
    if (n === null) continue;
    if (previous !== null && n > previous)
      throw new OutcomeInputError(
        "outcome_funnel_mismatch",
        "Use the same inquiry cohort: contacted, booked, attended and clients cannot increase through the funnel.",
      );
    previous = n;
  }
  if (
    result.cohortCollectedMinor !== null &&
    result.cohortBilledMinor !== null &&
    result.cohortCollectedMinor > result.cohortBilledMinor
  )
    throw new OutcomeInputError(
      "outcome_collection_mismatch",
      "Collected money cannot exceed billed money for invoices issued in this period and collected by its end.",
    );
  const hours = value.adminHours;
  if (hours !== null && hours !== undefined) {
    if (
      typeof hours !== "number" ||
      !Number.isFinite(hours) ||
      hours < 0 ||
      hours > days * 24 ||
      Math.abs(hours * 100 - Math.round(hours * 100)) > 0.000001
    )
      throw new OutcomeInputError(
        "invalid_outcome_hours",
        "Use your own non-negative administrative hours with at most two decimal places, or leave unknown.",
      );
    result.adminHours = hours;
  }
  if (
    [
      ...OUTCOME_COUNT_FIELDS,
      ...OUTCOME_MONEY_FIELDS,
      "adminHours" as const,
    ].every((field) => result[field] === null)
  )
    throw new OutcomeInputError(
      "empty_outcome",
      "Enter at least one known aggregate measure; leave other values blank.",
    );
  return result;
}
export function parseOutcomeRevision(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > OUTCOME_LIMITS.revision
  )
    throw new OutcomeInputError(
      "invalid_outcome_revision",
      "Reload this period before changing it.",
    );
  return value;
}
export function parseOutcomeConsent(value: unknown): {
  granted: boolean;
  revision: number;
} {
  if (
    !record(value) ||
    Object.keys(value).length !== 3 ||
    typeof value.granted !== "boolean" ||
    value.consentVersion !== OUTCOME_RESEARCH_VERSION
  )
    throw new OutcomeInputError(
      "invalid_outcome_consent",
      "Choose whether to include aggregate outcomes in research, using the current consent wording.",
    );
  return {
    granted: value.granted,
    revision: parseOutcomeRevision(value.revision),
  };
}
export function outcomePeriodsOverlap(
  a: Pick<OutcomePeriodInput, "startDate" | "endDate">,
  b: Pick<OutcomePeriodInput, "startDate" | "endDate">,
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}
const ratio = (numerator: number | null, denominator: number | null) =>
  numerator === null || denominator === null || denominator === 0
    ? null
    : numerator / denominator;
export function calculateOutcomeMetrics(period: OutcomePeriodInput) {
  return {
    periodDays: outcomePeriodDays(period.startDate, period.endDate),
    contactRate: ratio(period.contacted, period.inquiries),
    bookingRate: ratio(period.booked, period.contacted),
    attendanceRate: ratio(period.attended, period.booked),
    engagementRate: ratio(period.clients, period.attended),
    inquiryToClientRate: ratio(period.clients, period.inquiries),
    costPerClientMinor: ratio(period.leadSpendMinor, period.clients),
    collectionRate: ratio(
      period.cohortCollectedMinor,
      period.cohortBilledMinor,
    ),
    adminHoursPerDay: ratio(
      period.adminHours,
      outcomePeriodDays(period.startDate, period.endDate),
    ),
  };
}
