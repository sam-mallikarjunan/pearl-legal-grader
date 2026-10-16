/** Synthetic public excerpts and private answers, only for deterministic tests. */
import { parseWebsitePage } from "../server/website-inspect";
import { evaluateWebsite } from "../website/evaluate";
import type { WebsiteScanResult } from "../website/types";
import { DEFAULT_RELEASE } from "../catalog";
import { SAMPLE_CONTEXT, SAMPLE_ANSWERS, SAMPLE_CONTROLS } from "../demo";
import { assessPractice } from "../scoring";
import type { CloudReport } from "../account/types";
import type { AIReviewOutput, AIReviewSource } from "../ai-review";

export const AI_TEST_DATE = "2026-10-16T16:00:00.000Z";
export const AI_TEST_USER = "d013a8f7-944f-4ccf-b812-fa8b4b185cc6";
export const AI_TEST_REPORT = "869e4aca-92f8-4929-a2cf-b0f73f1112e8";
export function websiteAIScanFixture(): WebsiteScanResult {
  const page = parseWebsitePage(
    '<html><head><title>Juniper fictional family law</title><meta name="description" content="Understand your family law options and prepare for your first consultation."></head><body><h1>Clear next steps for family law</h1></body></html>',
    "https://fictional-law.example/",
    "home",
    AI_TEST_DATE,
  ).page;
  const performance = {
    status: "unavailable" as const,
    strategy: "mobile" as const,
    sourceUrl: page.url,
    fetchedAt: AI_TEST_DATE,
    categories: {},
    metrics: [],
    opportunities: [],
  };
  return {
    scannerVersion: "website-scan-v1",
    rubricVersion: "website-rubric-v1",
    status: "partial",
    submittedUrl: page.url,
    finalUrl: page.url,
    startedAt: AI_TEST_DATE,
    completedAt: AI_TEST_DATE,
    durationMs: 100,
    pages: [page],
    ...evaluateWebsite([page], performance),
    suggestedContext: {
      firmName: null,
      practiceAreas: [],
      locations: [],
      evidence: [],
      requiresConfirmation: true,
    },
    technologies: [],
    performance,
    warnings: [],
    limitations: ["Synthetic stored public-page fixture"],
  };
}
export function websiteAIReportFixture(): CloudReport {
  return {
    id: AI_TEST_REPORT,
    savedAt: AI_TEST_DATE,
    canonical: true,
    actionProgress: [],
    snapshot: {
      id: "c02de05b-683f-4d5a-93b9-2f41d30e4019",
      practiceId: "040946cb-9747-4cd9-9be6-a28cf8ddf793",
      createdAt: AI_TEST_DATE,
      label: "PRIVATE OWNER LABEL NOT FOR AI",
      isSample: false,
      assessment: assessPractice({
        context: {
          ...SAMPLE_CONTEXT,
          practiceArea: "PRIVATE OWNER ANSWER NOT FOR AI",
        },
        answers: SAMPLE_ANSWERS,
        controls: SAMPLE_CONTROLS,
        release: DEFAULT_RELEASE,
      }),
      websiteScan: websiteAIScanFixture(),
    },
  };
}
export function websiteAIOutputFixture(
  sources: AIReviewSource[],
): AIReviewOutput {
  return {
    explanations: [
      {
        title: "Make the next step easier to find",
        explanation:
          "This excerpt names the service area. Review whether it also makes a suitable next step clear.",
        suggestedNextStep:
          "Read the page as a first-time visitor and check the consultation invitation.",
        sourceId: sources[0].id,
        quote: sources[0].text,
      },
    ],
    abstainedReason: "",
  };
}
