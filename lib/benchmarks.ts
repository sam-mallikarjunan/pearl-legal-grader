/** Editorial reference data, deliberately separate from the scoring rubric. */
export const BENCHMARK_CATALOG_VERSION = "industry-reference-2026-10-19-v1";
export const BENCHMARK_REVIEWED_AT = "2026-10-19";
export const BENCHMARK_CATEGORIES = [
  "Intake",
  "Cash flow",
  "Website",
  "Technology",
] as const;
export type BenchmarkCategory = (typeof BENCHMARK_CATEGORIES)[number];
export interface IndustryBenchmark {
  id: string;
  title: string;
  category: BenchmarkCategory;
  kind: "observed" | "guidance";
  displayValue: string;
  unit: string;
  definition: string;
  cohort: string;
  period: string;
  denominator: string;
  limitation: string;
  nextAction: string;
  evidence:
    | "Platform observations"
    | "Secret-shop observations"
    | "Survey responses"
    | "Technical guidance";
  source: { title: string; url: string; accessedAt: string };
}
const source = (title: string, url: string) => ({
  title,
  url,
  accessedAt: BENCHMARK_REVIEWED_AT,
});
const clioKpi = source(
  "Clio · 2025 Legal Trends Report, Appendices A and B",
  "https://www.clio.com/resources/legal-trends/read-online/",
);
const intake = source(
  "Clio · 2024 Legal Trends Report highlights and methodology",
  "https://www.clio.com/blog/highlights-from-2024-legal-trends-report/",
);
const vitals = source(
  "Google web.dev · Core Web Vitals thresholds",
  "https://web.dev/articles/defining-core-web-vitals-thresholds",
);
const soloAi = source(
  "Clio · 2026 solo and small firm AI report findings",
  "https://www.clio.com/blog/solo-small-law-firm-ai-time-savings/",
);
const kpiCohort =
  "U.S. paid Clio subscribers; anonymized platform data. Opt-outs and statistical outliers excluded.";
const kpiPeriod =
  "2025 report edition; the linked KPI summary does not state the exact observation cutoff.";
const kpiLimitation =
  "Vendor-customer sample, not all firms. Hourly-work measures may fit flat-fee, contingency, or early-stage practices poorly.";
const shopCohort =
  "500 law firms contacted by Lux for Clio's secret-shop study.";
const shopPeriod = "June 20–July 5, 2024.";
const aiCohort =
  "Solo respondents in Clio's 2026 solo and small firm research.";
const aiPeriod =
  "2026 report edition; exact survey fieldwork dates are not stated in the linked summary.";
const aiLimitation =
  "Self-reported vendor research. Solo subgroup sample size is not disclosed in the public summary. Adoption is not proof of safety or business benefit.";

export const INDUSTRY_BENCHMARKS: readonly IndustryBenchmark[] = [
  {
    id: "phone-answer",
    title: "Answering a new inquiry by phone",
    category: "Intake",
    kind: "observed",
    displayValue: "40%",
    unit: "% of contacted firms",
    definition:
      "Firms that answered the shopper's call live, rather than a later callback.",
    cohort: shopCohort,
    period: shopPeriod,
    denominator:
      "The 500 firms in this study; not the share of all calls an individual firm answers.",
    limitation:
      "One study's inquiry protocol. This is not a recommended service target or an estimate of your missed leads.",
    nextAction:
      "Track eligible new-inquiry calls, live answers, callbacks, and time to first human response separately for one consistent period.",
    evidence: "Secret-shop observations",
    source: intake,
  },
  {
    id: "email-response",
    title: "Responding to a new email inquiry",
    category: "Intake",
    kind: "observed",
    displayValue: "33%",
    unit: "% of contacted firms",
    definition: "Firms that responded to the shopper's emailed inquiry.",
    cohort: shopCohort,
    period: shopPeriod,
    denominator:
      "The 500 firms contacted in the secret-shop study; not client conversion rate.",
    limitation:
      "The summary does not establish a universal response-time target. A reply is not a booked consultation or a retained client.",
    nextAction:
      "Test your published contact route yourself. Log receipt, first human reply, fit, booking, attendance, and engagement without merging stages.",
    evidence: "Secret-shop observations",
    source: intake,
  },
  {
    id: "utilization",
    title: "Time going toward billable work",
    category: "Cash flow",
    kind: "observed",
    displayValue: "38%",
    unit: "% of an eight-hour workday",
    definition: "Billable work time divided by an eight-hour day.",
    cohort: kpiCohort,
    period: kpiPeriod,
    denominator:
      "An eight-hour workday; Clio describes data from tens of thousands of legal professionals, without a metric-specific n here.",
    limitation: kpiLimitation,
    nextAction:
      "Separate legal work, intake, administration, and time off before choosing a sustainable capacity target for your own goals.",
    evidence: "Platform observations",
    source: clioKpi,
  },
  {
    id: "realization",
    title: "Work that reaches an invoice",
    category: "Cash flow",
    kind: "observed",
    displayValue: "88%",
    unit: "% of billable work",
    definition:
      "Billable work invoiced divided by billable work recorded, using comparable units.",
    cohort: kpiCohort,
    period: kpiPeriod,
    denominator:
      "Recorded billable work in the platform sample; metric-specific n not stated in the linked summary.",
    limitation: kpiLimitation,
    nextAction:
      "Review write-down reasons and invoice lag. Keep a legitimate pricing decision separate from work lost through incomplete time capture.",
    evidence: "Platform observations",
    source: clioKpi,
  },
  {
    id: "collection",
    title: "Invoices that turn into collected cash",
    category: "Cash flow",
    kind: "observed",
    displayValue: "93%",
    unit: "% of invoiced work paid",
    definition: "The share of invoiced work that is paid.",
    cohort: kpiCohort,
    period: kpiPeriod,
    denominator:
      "Invoiced work in the platform sample; metric-specific n not stated in the linked summary.",
    limitation:
      "Vendor-customer sample. Cash received this month divided by invoices issued this month can mix cohorts and is not a clean collection rate.",
    nextAction:
      "Follow a fixed invoice cohort through payment, credits, write-offs, and overdue balances. Document how retainers and refunds are treated.",
    evidence: "Platform observations",
    source: clioKpi,
  },
  {
    id: "total-lockup",
    title: "Work waiting to become cash",
    category: "Cash flow",
    kind: "observed",
    displayValue: "About 93 days",
    unit: "days of work held unbilled or unpaid",
    definition:
      "Total lockup combines work in progress and accounts receivable.",
    cohort: kpiCohort,
    period: kpiPeriod,
    denominator:
      "A cash-flow stock expressed in days of work; not an average invoice's age or days to payment.",
    limitation:
      "The online summary calls this about 93 days; it does not identify the aggregation statistic. Do not relabel it as a median or DSO.",
    nextAction:
      "Track unbilled work and unpaid invoices separately. Use a consistent annual-collections basis in the calculator below.",
    evidence: "Platform observations",
    source: clioKpi,
  },
  {
    id: "lcp",
    title: "Main content becomes visible",
    category: "Website",
    kind: "guidance",
    displayValue: "≤ 2.5 seconds",
    unit: "LCP at the 75th percentile",
    definition:
      "Largest Contentful Paint measures when the largest main-content element is rendered.",
    cohort:
      "Page visits measured in the field; evaluate mobile and desktop separately.",
    period: "Current Google guidance checked October 19, 2026.",
    denominator:
      "The 75th percentile of eligible page visits, not one laboratory run.",
    limitation:
      "A lab scan is a useful diagnostic, but cannot establish that real visitors meet a field threshold.",
    nextAction:
      "Start with the largest hero image, response time, and render-blocking assets. Verify improvements with real-visitor data when available.",
    evidence: "Technical guidance",
    source: vitals,
  },
  {
    id: "inp",
    title: "The page responds to interaction",
    category: "Website",
    kind: "guidance",
    displayValue: "≤ 200 ms",
    unit: "INP at the 75th percentile",
    definition:
      "Interaction to Next Paint describes responsiveness to user interaction.",
    cohort:
      "Eligible real page visits with interactions; mobile and desktop assessed separately.",
    period: "Current Google guidance checked October 19, 2026.",
    denominator: "The 75th percentile of eligible field measurements.",
    limitation:
      "A load-only Lighthouse run cannot measure real-user INP. Total Blocking Time is a different laboratory metric.",
    nextAction:
      "Try your contact and booking controls on a modest phone. Reduce long JavaScript tasks and confirm with field measurements.",
    evidence: "Technical guidance",
    source: vitals,
  },
  {
    id: "cls",
    title: "The layout stays steady",
    category: "Website",
    kind: "guidance",
    displayValue: "≤ 0.1",
    unit: "unitless CLS at the 75th percentile",
    definition: "Cumulative Layout Shift measures unexpected visual movement.",
    cohort: "Real page visits, assessed separately by device class.",
    period: "Current Google guidance checked October 19, 2026.",
    denominator: "The 75th percentile of field layout-shift scores.",
    limitation:
      "CLS is a score, not seconds. A lab scan may miss movement later in a visit.",
    nextAction:
      "Reserve image and embed space and test banners, fonts, and booking widgets throughout a complete visit.",
    evidence: "Technical guidance",
    source: vitals,
  },
  {
    id: "solo-mfa",
    title: "Solo use of two-factor authentication",
    category: "Technology",
    kind: "observed",
    displayValue: "54.7%",
    unit: "% of solo survey respondents",
    definition:
      "Reported adoption of two-factor authentication in the ABA's solo-firm summary.",
    cohort: "Solo lawyers responding to the 2024 ABA Legal Technology Survey.",
    period: "2024 survey; public TechReport published April 21, 2025.",
    denominator:
      "Solo respondent subgroup; exact subgroup n is not provided in the public summary.",
    limitation:
      "Dated, self-reported adoption. Use does not establish coverage of every account or resistance to phishing.",
    nextAction:
      "Inventory business accounts and recovery access. Prioritize strong MFA for email, practice systems, banking, and administrator access.",
    evidence: "Survey responses",
    source: source(
      "ABA · 2024 Solo and Small Firm TechReport",
      "https://www.americanbar.org/groups/law_practice/resources/tech-report/2024/2024-solo-and-small-firm-techreport/",
    ),
  },
  {
    id: "solo-ai-use",
    title: "Solo firms reporting AI use",
    category: "Technology",
    kind: "observed",
    displayValue: "71%",
    unit: "% of solo respondents",
    definition: "Solo respondents reporting AI use in Clio's 2026 findings.",
    cohort: aiCohort,
    period: aiPeriod,
    denominator:
      "Solo respondents, not all 1,700+ participants across the broader report.",
    limitation: aiLimitation,
    nextAction:
      "Choose one bounded business task and measure time saved, review effort, quality, and cost before expanding use.",
    evidence: "Survey responses",
    source: soloAi,
  },
  {
    id: "solo-ai-policy",
    title: "Solo firms without a written AI policy",
    category: "Technology",
    kind: "observed",
    displayValue: "57%",
    unit: "% of solo respondents",
    definition: "Solo respondents reporting no written policy for AI use.",
    cohort: aiCohort,
    period: aiPeriod,
    denominator:
      "Solo respondent subgroup; the summary does not disclose its size or a separate AI-user denominator.",
    limitation: aiLimitation,
    nextAction:
      "Write down approved tools, permitted data, human checks, and an owner for exceptions. Check the rules that apply in your jurisdiction.",
    evidence: "Survey responses",
    source: soloAi,
  },
];

export function searchIndustryBenchmarks(
  query: string,
  category = "All",
  kind = "All",
) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return INDUSTRY_BENCHMARKS.filter(
    (item) =>
      (category === "All" || item.category === category) &&
      (kind === "All" || item.kind === kind) &&
      words.every((word) =>
        `${item.title} ${item.category} ${item.definition} ${item.cohort} ${item.source.title}`
          .toLocaleLowerCase()
          .includes(word),
      ),
  );
}

const validAmount = (value: number | null): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1_000_000_000_000;
const validCount = (value: number | null): value is number =>
  validAmount(value) && Number.isSafeInteger(value);
const ratio = (numerator: number | null, denominator: number | null) =>
  validAmount(numerator) && validAmount(denominator) && denominator > 0
    ? numerator / denominator
    : null;

export function calculateFunnel(input: {
  spend: number | null;
  leads: number | null;
  booked: number | null;
  showed: number | null;
  clients: number | null;
}) {
  if (
    ![input.leads, input.booked, input.showed, input.clients].every(
      (n) => n === null || validCount(n),
    ) ||
    (input.spend !== null && !validAmount(input.spend))
  )
    return null;
  const known = [input.leads, input.booked, input.showed, input.clients];
  for (let i = 0; i < known.length; i++)
    for (let j = i + 1; j < known.length; j++) {
      if (known[i] !== null && known[j] !== null && known[j]! > known[i]!)
        return null;
    }
  return {
    costPerLead: ratio(input.spend, input.leads),
    costPerClient: ratio(input.spend, input.clients),
    bookingRate: ratio(input.booked, input.leads),
    showRate: ratio(input.showed, input.booked),
    retentionRate: ratio(input.clients, input.showed),
    leadToClientRate: ratio(input.clients, input.leads),
  };
}

export function calculateCashLockup(input: {
  workInProgress: number | null;
  receivables: number | null;
  annualCollections: number | null;
}) {
  if (Object.values(input).some((n) => n !== null && !validAmount(n)))
    return null;
  const wip = ratio(input.workInProgress, input.annualCollections);
  const ar = ratio(input.receivables, input.annualCollections);
  return {
    realizationDays: wip === null ? null : wip * 365,
    collectionDays: ar === null ? null : ar * 365,
    totalDays: wip === null || ar === null ? null : (wip + ar) * 365,
  };
}

export function parseBenchmarkNumber(value: string): number | null {
  return value.trim() &&
    /^\d+(?:\.\d+)?$/.test(value.trim()) &&
    validAmount(Number(value))
    ? Number(value)
    : null;
}
