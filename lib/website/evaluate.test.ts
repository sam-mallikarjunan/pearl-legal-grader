import test from "node:test";
import assert from "node:assert/strict";
import { evaluateWebsite } from "./evaluate";
import type { WebsitePage, WebsitePageSignals } from "./types";
import { unavailablePerformance } from "../server/pagespeed";

const date = "2026-10-15T10:00:00.000Z";
const emptySignals: WebsitePageSignals = {
  title: null,
  description: null,
  h1Count: 0,
  h1: [],
  hasViewport: false,
  hasCanonical: false,
  noindex: false,
  hasStructuredData: false,
  hasPhoneLink: false,
  hasEmailLink: false,
  hasContactForm: false,
  hasBookingLink: false,
  hasContactLink: false,
  hasConsultationLanguage: false,
  hasServiceLanguage: false,
  hasPeopleLanguage: false,
  hasLocationLanguage: false,
  imageCount: 0,
  imagesMissingAlt: 0,
  formControlCount: 0,
  unlabeledFormControlCount: 0,
  visibleWordCount: 100,
  likelyJavascriptShell: false,
};
const page = (signals: Partial<WebsitePageSignals> = {}): WebsitePage => ({
  url: "https://lawfirm.com/",
  kind: "home",
  status: "inspected",
  fetchedAt: date,
  signals: { ...emptySignals, ...signals },
});
const performance = unavailablePerformance(
  "https://lawfirm.com/",
  "No lab data",
);

test("unavailable pages and absent lab data remain unmeasured and cannot create a zero grade", () => {
  const result = evaluateWebsite(
    [
      {
        url: "https://lawfirm.com/",
        kind: "home",
        status: "blocked",
        fetchedAt: date,
      },
    ],
    performance,
  );
  assert.equal(result.score, null);
  assert.equal(result.coverage, 0);
  assert.ok(
    result.findings.every((f) => f.points === null && f.status === "unknown"),
  );
});

test("JavaScript shells do not turn missing contact, metadata or mobile signals into failures", () => {
  const result = evaluateWebsite(
    [page({ likelyJavascriptShell: true, visibleWordCount: 0 })],
    performance,
  );
  assert.equal(result.score, null);
  assert.equal(
    result.findings.find((f) => f.id === "contact-route")?.points,
    null,
  );
  assert.equal(
    result.findings.find((f) => f.id === "page-metadata")?.points,
    null,
  );
  assert.equal(
    result.findings.find((f) => f.id === "mobile-viewport")?.points,
    null,
  );
  assert.equal(result.findings.find((f) => f.id === "https")?.points, 100);
});

test("confirmed missing signals create prioritized actions but unavailable checks never do", () => {
  const result = evaluateWebsite([page()], performance);
  assert.ok(result.score !== null && result.score > 0);
  assert.equal(result.findings[0].id, "contact-route");
  assert.equal(result.findings[0].points, 0);
  assert.equal(
    result.findings[0].action?.title,
    "Make contacting your practice easy",
  );
  assert.equal(
    result.findings.find((f) => f.id === "mobile-performance")?.action,
    undefined,
  );
  assert.equal(result.findings.find((f) => f.id === "image-alt")?.points, null);
  assert.equal(
    result.findings.find((f) => f.id === "form-labels")?.points,
    null,
  );
});

test("blocked contact-page evidence makes negative site-wide inference unknown rather than failed", () => {
  const result = evaluateWebsite(
    [
      page(),
      {
        url: "https://lawfirm.com/contact",
        kind: "contact",
        status: "blocked",
        fetchedAt: date,
      },
    ],
    performance,
  );
  assert.equal(
    result.findings.find((f) => f.id === "contact-route")?.points,
    null,
  );
  assert.equal(
    result.findings.find((f) => f.id === "consultation-next-step")?.points,
    null,
  );
});

test("score weights add to 100 and unknown laboratory results change coverage rather than award zero", () => {
  const result = evaluateWebsite(
    [
      page({
        title: "Firm",
        description: "Public firm",
        hasPhoneLink: true,
        hasContactLink: true,
        hasConsultationLanguage: true,
        hasServiceLanguage: true,
        hasPeopleLanguage: true,
        hasLocationLanguage: true,
        h1Count: 1,
        hasViewport: true,
        imageCount: 1,
        formControlCount: 1,
      }),
    ],
    performance,
  );
  assert.equal(
    result.findings.reduce((n, f) => n + f.weight, 0),
    100,
  );
  assert.equal(result.coverage, 81);
  assert.equal(result.score, 100);
  assert.equal(result.measuredChecks, 13);
  assert.equal(result.totalChecks, 15);
});
