/** Public, JSON-safe scan contract. No HTML, cookies, credentials or form contents. */
export const WEBSITE_SCANNER_VERSION = "website-scan-v1";
export const WEBSITE_RUBRIC_VERSION = "website-rubric-v1";

export type WebsiteFindingStatus =
  | "pass"
  | "needs_attention"
  | "unknown"
  | "info";
export type WebsiteCategory =
  | "availability"
  | "contact"
  | "clarity"
  | "search"
  | "mobile"
  | "accessibility";

export interface WebsiteEvidence {
  sourceUrl: string;
  observedAt: string;
  detail: string;
}

export interface WebsiteAction {
  title: string;
  why: string;
  steps: string[];
  effort: "small" | "medium" | "large";
}

export interface WebsiteFinding {
  id: string;
  category: WebsiteCategory;
  title: string;
  status: WebsiteFindingStatus;
  summary: string;
  evidence: WebsiteEvidence[];
  method: "html" | "lighthouse";
  weight: number;
  /** Observed points on a 0–100 scale; null means unmeasured and is never zero. */
  points: number | null;
  action?: WebsiteAction;
  limitation?: string;
}

export interface WebsitePageSignals {
  title: string | null;
  description: string | null;
  h1Count: number;
  h1: string[];
  hasViewport: boolean;
  hasCanonical: boolean;
  noindex: boolean;
  hasStructuredData: boolean;
  hasPhoneLink: boolean;
  hasEmailLink: boolean;
  hasContactForm: boolean;
  hasBookingLink: boolean;
  hasContactLink: boolean;
  hasConsultationLanguage: boolean;
  hasServiceLanguage: boolean;
  hasPeopleLanguage: boolean;
  hasLocationLanguage: boolean;
  imageCount: number;
  imagesMissingAlt: number;
  formControlCount: number;
  unlabeledFormControlCount: number;
  visibleWordCount: number;
  likelyJavascriptShell: boolean;
}

export interface WebsitePage {
  url: string;
  kind: "home" | "contact" | "services" | "about" | "fees";
  status: "inspected" | "blocked" | "unavailable";
  fetchedAt: string;
  httpStatus?: number;
  reason?: string;
  signals?: WebsitePageSignals;
}

export interface WebsiteTechnology {
  name: string;
  category: "analytics" | "advertising" | "chat" | "booking" | "platform";
  evidence: WebsiteEvidence;
}

export interface WebsitePerformance {
  status: "available" | "unavailable";
  provider?: "google-pagespeed" | "vercel-lighthouse";
  strategy: "mobile";
  fetchedAt: string;
  sourceUrl: string;
  reason?: string;
  /** Lighthouse laboratory audit scores, 0–100; absent categories are unmeasured. */
  categories: Partial<
    Record<"performance" | "accessibility" | "seo" | "best-practices", number>
  >;
  metrics: Array<{
    id: string;
    label: string;
    value: number;
    unit: "ms" | "unitless";
  }>;
  opportunities: Array<{
    id: string;
    title: string;
    description: string;
    savingsMs?: number;
  }>;
  lighthouseVersion?: string;
}

export interface WebsiteSuggestedContext {
  firmName: string | null;
  practiceAreas: string[];
  /** Text clues from public structured data, never verified jurisdiction or licensing. */
  locations: string[];
  evidence: WebsiteEvidence[];
  requiresConfirmation: true;
}

export interface WebsiteScanResult {
  scannerVersion: string;
  rubricVersion: string;
  status: "complete" | "partial" | "unavailable";
  submittedUrl: string;
  finalUrl: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  pages: WebsitePage[];
  findings: WebsiteFinding[];
  /** Weighted score over measured checks only; null when evidence is insufficient. */
  score: number | null;
  /** Weighted evidence coverage in percent (0–100), separate from the score. */
  coverage: number;
  measuredChecks: number;
  totalChecks: number;
  suggestedContext: WebsiteSuggestedContext;
  technologies: WebsiteTechnology[];
  performance: WebsitePerformance;
  warnings: string[];
  limitations: string[];
}

export interface WebsiteScanProgress {
  stage: "checking" | "inspecting" | "performance" | "evaluating";
  message: string;
  pagesInspected: number;
}

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 2000): v is string =>
  typeof v === "string" && v.length <= max;
const num = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
const strings = (v: unknown, max = 100): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((s) => str(s));
const date = (v: unknown): v is string =>
  str(v, 40) && Number.isFinite(Date.parse(v));
const url = (v: unknown): v is string => {
  if (!str(v, 2048)) return false;
  try {
    const u = new URL(v);
    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
};
const evidence = (v: unknown): v is WebsiteEvidence =>
  record(v) && url(v.sourceUrl) && date(v.observedAt) && str(v.detail);

/** Defensive validation for device-local history and API results. */
export function isWebsiteScanResult(
  value: unknown,
): value is WebsiteScanResult {
  if (
    !record(value) ||
    !str(value.scannerVersion, 80) ||
    !str(value.rubricVersion, 80) ||
    !["complete", "partial", "unavailable"].includes(value.status as string) ||
    !url(value.submittedUrl) ||
    !(value.finalUrl === null || url(value.finalUrl)) ||
    !date(value.startedAt) ||
    !date(value.completedAt) ||
    !num(value.durationMs) ||
    !(value.score === null || num(value.score, 100)) ||
    !num(value.coverage, 100) ||
    !num(value.measuredChecks, 100) ||
    !num(value.totalChecks, 100) ||
    !strings(value.warnings) ||
    !strings(value.limitations)
  )
    return false;
  if (
    !Array.isArray(value.pages) ||
    value.pages.length > 5 ||
    !value.pages.every((p) => {
      if (
        !record(p) ||
        !url(p.url) ||
        !date(p.fetchedAt) ||
        !["home", "contact", "services", "about", "fees"].includes(
          p.kind as string,
        ) ||
        !["inspected", "blocked", "unavailable"].includes(p.status as string) ||
        (p.reason !== undefined && !str(p.reason)) ||
        (p.httpStatus !== undefined && !num(p.httpStatus, 599))
      )
        return false;
      if (p.signals === undefined) return p.status !== "inspected";
      const s = p.signals;
      return (
        record(s) &&
        (s.title === null || str(s.title)) &&
        (s.description === null || str(s.description)) &&
        strings(s.h1, 8) &&
        [
          "h1Count",
          "imageCount",
          "imagesMissingAlt",
          "formControlCount",
          "unlabeledFormControlCount",
          "visibleWordCount",
        ].every((k) => num(s[k], 1_000_000)) &&
        [
          "hasViewport",
          "hasCanonical",
          "noindex",
          "hasStructuredData",
          "hasPhoneLink",
          "hasEmailLink",
          "hasContactForm",
          "hasBookingLink",
          "hasContactLink",
          "hasConsultationLanguage",
          "hasServiceLanguage",
          "hasPeopleLanguage",
          "hasLocationLanguage",
          "likelyJavascriptShell",
        ].every((k) => typeof s[k] === "boolean")
      );
    })
  )
    return false;
  if (
    !Array.isArray(value.findings) ||
    value.findings.length > 50 ||
    !value.findings.every(
      (f) =>
        record(f) &&
        str(f.id, 100) &&
        str(f.title, 300) &&
        [
          "availability",
          "contact",
          "clarity",
          "search",
          "mobile",
          "accessibility",
        ].includes(f.category as string) &&
        ["pass", "needs_attention", "unknown", "info"].includes(
          f.status as string,
        ) &&
        str(f.summary) &&
        ["html", "lighthouse"].includes(f.method as string) &&
        num(f.weight, 100) &&
        (f.points === null || num(f.points, 100)) &&
        (f.limitation === undefined || str(f.limitation)) &&
        Array.isArray(f.evidence) &&
        f.evidence.length <= 12 &&
        f.evidence.every(evidence) &&
        (f.action === undefined ||
          (record(f.action) &&
            str(f.action.title, 300) &&
            str(f.action.why) &&
            strings(f.action.steps, 10) &&
            ["small", "medium", "large"].includes(f.action.effort as string))),
    )
  )
    return false;
  const c = value.suggestedContext;
  if (
    !record(c) ||
    !(c.firmName === null || str(c.firmName, 300)) ||
    !strings(c.practiceAreas, 30) ||
    !strings(c.locations, 10) ||
    c.requiresConfirmation !== true ||
    !Array.isArray(c.evidence) ||
    c.evidence.length > 12 ||
    !c.evidence.every(evidence)
  )
    return false;
  if (
    !Array.isArray(value.technologies) ||
    value.technologies.length > 30 ||
    !value.technologies.every(
      (t) =>
        record(t) &&
        str(t.name, 100) &&
        ["analytics", "advertising", "chat", "booking", "platform"].includes(
          t.category as string,
        ) &&
        evidence(t.evidence),
    )
  )
    return false;
  const p = value.performance;
  return (
    record(p) &&
    ["available", "unavailable"].includes(p.status as string) &&
    (p.provider === undefined ||
      ["google-pagespeed", "vercel-lighthouse"].includes(
        p.provider as string,
      )) &&
    p.strategy === "mobile" &&
    date(p.fetchedAt) &&
    url(p.sourceUrl) &&
    (p.reason === undefined || str(p.reason)) &&
    (p.lighthouseVersion === undefined || str(p.lighthouseVersion, 100)) &&
    record(p.categories) &&
    Object.entries(p.categories).every(
      ([k, v]) =>
        ["performance", "accessibility", "seo", "best-practices"].includes(k) &&
        num(v, 100),
    ) &&
    Array.isArray(p.metrics) &&
    p.metrics.length <= 12 &&
    p.metrics.every(
      (m) =>
        record(m) &&
        str(m.id, 100) &&
        str(m.label, 200) &&
        num(m.value) &&
        ["ms", "unitless"].includes(m.unit as string),
    ) &&
    Array.isArray(p.opportunities) &&
    p.opportunities.length <= 10 &&
    p.opportunities.every(
      (o) =>
        record(o) &&
        str(o.id, 100) &&
        str(o.title, 300) &&
        str(o.description) &&
        (o.savingsMs === undefined || num(o.savingsMs)),
    )
  );
}
