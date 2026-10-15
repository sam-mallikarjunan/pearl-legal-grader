import test from "node:test";
import assert from "node:assert/strict";
import { inspectWebsite, parseWebsitePage } from "./website-inspect";
import { isWebsiteScanResult, type WebsitePerformance } from "../website/types";
import { unavailablePerformance } from "./pagespeed";
import {
  WebsiteFetchError,
  type WebsiteFetchOptions,
  type WebsiteFetchResult,
} from "./website-fetch";

const DATE = "2026-10-15T10:00:00.000Z";
const fixture = `<!doctype html><html><head><title>Juniper Test Law</title><meta name="description" content="Family law and estate planning."><meta name="viewport" content="width=device-width, initial-scale=1"><meta property="og:site_name" content="Juniper Test Law"><script type="application/ld+json">{"@context":"https://schema.org","@type":"LegalService","name":"Juniper Test Law","address":{"@type":"PostalAddress","addressLocality":"Portland","addressRegion":"Oregon"}}</script><script src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script></head><body><h1>Family law for your next chapter</h1><p>Our attorneys offer thoughtful family law and estate planning services. We serve clients with clear advice about important decisions. Our team helps you understand your options and prepare for a useful consultation. Learn more about our services and contact us to ask about your first appointment.</p><nav><a href="/contact">Contact</a><a href="/services">Our services</a><a href="/about">About us</a><a href="/fees">Fees</a><a href="/client-portal">Client portal</a><a href="https://elsewhere.com/about">External about</a><a href="/contact?token=secret">Token route</a></nav><a href="tel:+15035550123">Call</a><a href="mailto:hello@juniper.test">Email</a><img src="/team.jpg" alt="Our team"><form action="/submit" method="POST"><label for="email">Email</label><input id="email" type="email"><label>Message<textarea name="message"></textarea></label></form></body></html>`;
const performance: WebsitePerformance = {
  status: "available",
  strategy: "mobile",
  fetchedAt: DATE,
  sourceUrl: "https://lawfirm.com/",
  categories: { performance: 85, accessibility: 95 },
  metrics: [],
  opportunities: [],
};

test("static parsing extracts public evidence and context without following private, external or query links", () => {
  const parsed = parseWebsitePage(
    fixture,
    "https://lawfirm.com/",
    "home",
    DATE,
  );
  assert.equal(parsed.page.signals?.hasPhoneLink, true);
  assert.equal(parsed.page.signals?.hasContactForm, true);
  assert.equal(parsed.page.signals?.unlabeledFormControlCount, 0);
  assert.equal(parsed.page.signals?.hasViewport, true);
  assert.equal(parsed.context.firmName, "Juniper Test Law");
  assert.deepEqual(parsed.context.locations, ["Portland, Oregon"]);
  assert.deepEqual(parsed.context.practiceAreas, [
    "Family law",
    "Estate planning",
  ]);
  assert.equal(parsed.context.requiresConfirmation, true);
  assert.deepEqual(
    parsed.candidates.map((c) => c.url),
    [
      "https://lawfirm.com/contact",
      "https://lawfirm.com/services",
      "https://lawfirm.com/about",
      "https://lawfirm.com/fees",
    ],
  );
  assert.equal(parsed.technologies[0].name, "Google Analytics");
  assert.ok(!JSON.stringify(parsed).includes("hello@"));
  assert.ok(!JSON.stringify(parsed).includes("5550123"));
  assert.ok(!JSON.stringify(parsed).includes("token=secret"));
});

test("hidden markup and scripts do not become visible copy or contact evidence", () => {
  const parsed = parseWebsitePage(
    '<html><body><div hidden><a href="tel:1234567890">Contact us for family law</a></div><div style="display: none">Immigration</div><script>window.contact="Contact us for bankruptcy"</script><main id="root"></main></body></html>',
    "https://lawfirm.com/",
    "home",
    DATE,
  );
  assert.equal(parsed.page.signals?.hasPhoneLink, false);
  assert.equal(parsed.page.signals?.hasConsultationLanguage, false);
  assert.deepEqual(parsed.context.practiceAreas, []);
  assert.equal(parsed.page.signals?.likelyJavascriptShell, true);
});

test("bounded scanner visits at most five public pages, never submits forms and returns a validated result", async () => {
  const visited: string[] = [];
  const fetcher = async (
    input: string | URL,
    options?: WebsiteFetchOptions,
  ): Promise<WebsiteFetchResult> => {
    const url = new URL(String(input));
    visited.push(url.href);
    await options?.authorize?.(url);
    return {
      url: url.href,
      status: 200,
      headers: {},
      body:
        url.pathname === "/robots.txt" ? "User-agent: *\nAllow: /" : fixture,
      redirects: 0,
    };
  };
  const result = await inspectWebsite("https://lawfirm.com/", undefined, {
    fetcher,
    performanceProvider: async () => performance,
  });
  assert.equal(result.status, "complete");
  assert.equal(result.pages.length, 5);
  assert.equal(result.score, 98);
  assert.equal(result.coverage, 100);
  assert.equal(visited.length, 6); // five HTML pages and one cached robots policy.
  assert.ok(
    visited.every(
      (u) => !u.includes("/submit") && !u.includes("client-portal"),
    ),
  );
  assert.equal(isWebsiteScanResult(result), true);
});

test("a disallowed robots page is not fetched and failed policy lookup stops rather than assuming permission", async () => {
  let htmlReads = 0;
  const fetcher = async (
    input: string | URL,
    options?: WebsiteFetchOptions,
  ): Promise<WebsiteFetchResult> => {
    const url = new URL(String(input));
    await options?.authorize?.(url);
    if (url.pathname !== "/robots.txt") htmlReads++;
    return {
      url: url.href,
      status: 200,
      headers: {},
      body: "User-agent: *\nDisallow: /",
      redirects: 0,
    };
  };
  let audits = 0;
  const result = await inspectWebsite("https://lawfirm.com/", undefined, {
    fetcher,
    performanceProvider: async () => {
      audits++;
      return performance;
    },
  });
  assert.equal(htmlReads, 0);
  assert.equal(audits, 0);
  assert.equal(result.status, "unavailable");
  assert.equal(result.score, null);
  assert.equal(result.coverage, 0);
  assert.equal(result.pages[0].status, "blocked");
  assert.equal(isWebsiteScanResult(result), true);
  const failed = await inspectWebsite("https://lawfirm.com/", undefined, {
    fetcher: async () => {
      throw new WebsiteFetchError("network", "Network unavailable");
    },
  });
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.score, null);
});

test("quota failures and blocked subpages produce a partial result with unmeasured checks", async () => {
  const fetcher = async (
    input: string | URL,
    options?: WebsiteFetchOptions,
  ): Promise<WebsiteFetchResult> => {
    const url = new URL(String(input));
    await options?.authorize?.(url);
    return {
      url: url.href,
      status: url.pathname === "/contact" ? 403 : 200,
      headers: {},
      body:
        url.pathname === "/robots.txt" ? "User-agent: *\nAllow: /" : fixture,
      redirects: 0,
    };
  };
  const result = await inspectWebsite("https://lawfirm.com/", undefined, {
    fetcher,
    performanceProvider: async () =>
      unavailablePerformance("https://lawfirm.com/", "Quota unavailable"),
  });
  assert.equal(result.status, "partial");
  assert.equal(result.coverage, 81);
  assert.equal(
    result.findings.find((f) => f.id === "mobile-performance")?.points,
    null,
  );
  assert.equal(
    result.findings.find((f) => f.id === "automated-accessibility")?.status,
    "unknown",
  );
  assert.equal(
    result.pages.find((p) => p.kind === "contact")?.status,
    "blocked",
  );
  assert.equal(isWebsiteScanResult(result), true);
});
