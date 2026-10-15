import test from "node:test";
import assert from "node:assert/strict";
import { parsePageSpeedResponse, unavailablePerformance } from "./pagespeed";

test("mobile audit parsing retains bounded actual measurements and ordered opportunities", () => {
  const result = parsePageSpeedResponse(
    {
      lighthouseResult: {
        lighthouseVersion: "13.0",
        categories: {
          performance: { score: 0.82 },
          accessibility: { score: 0.95 },
          seo: { score: null },
          "best-practices": { score: 9 },
        },
        audits: {
          "largest-contentful-paint": { numericValue: 2345.6789 },
          "cumulative-layout-shift": { numericValue: 0.037 },
          "first-contentful-paint": { numericValue: NaN },
          small: {
            title: "Small <b>saving</b>",
            description: "A [guide](https://example.org)",
            score: 0.4,
            details: { overallSavingsMs: 100 },
          },
          large: {
            title: "Large saving",
            score: 0.1,
            details: { overallSavingsMs: 500 },
          },
          missing: { title: "No estimate", score: 0.2 },
        },
      },
    },
    "https://lawfirm.com/",
    "2026-10-15T10:00:00.000Z",
  );
  assert.equal(result.status, "available");
  assert.deepEqual(result.categories, { performance: 82, accessibility: 95 });
  assert.deepEqual(
    result.metrics.map((m) => [m.id, m.value]),
    [
      ["largest-contentful-paint", 2345.679],
      ["cumulative-layout-shift", 0.037],
    ],
  );
  assert.deepEqual(
    result.opportunities.map((o) => o.id),
    ["large", "small"],
  );
  assert.equal(result.opportunities[1].title, "Small saving");
});

test("runtime errors, absent scores and unavailable provider results never become zero", () => {
  for (const data of [
    null,
    {},
    { error: { code: 429 } },
    { lighthouseResult: { categories: {}, runtimeError: { code: "NO_FCP" } } },
    { lighthouseResult: { categories: { performance: { score: null } } } },
  ]) {
    const result = parsePageSpeedResponse(data, "https://lawfirm.com/");
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.categories, {});
  }
  assert.equal(
    unavailablePerformance("https://lawfirm.com/", "quota unavailable")
      .categories.performance,
    undefined,
  );
});
