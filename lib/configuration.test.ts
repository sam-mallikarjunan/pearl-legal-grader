import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "./catalog";
import {
  canonicalJson,
  compareConfiguration,
  validatePublishedConfig,
} from "./configuration";

test("configuration canonical encoding is independent of object key order and preserves array order", () => {
  assert.equal(
    canonicalJson({ b: [1, 2], a: { y: 3, x: 4 } }),
    canonicalJson({ a: { x: 4, y: 3 }, b: [1, 2] }),
  );
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});
test("the exact initial release satisfies the publishable typed schema", () => {
  assert.deepEqual(validatePublishedConfig(DEFAULT_RELEASE), []);
});
test("published config rejects arbitrary operators, points and weakened evidence gates", () => {
  const release = structuredClone(DEFAULT_RELEASE);
  release.minCoverage = 0.2;
  (release.actions[0].trigger as unknown as { type: string }).type =
    "execute_script";
  release.questions[0].options[0].points = 100;
  assert.ok(validatePublishedConfig(release).length >= 3);
});
test("published config rejects oversized values, invalid catalogue references and unsupported colors", () => {
  const release = structuredClone(DEFAULT_RELEASE);
  release.questions[0].catalogueIds = ["private-source-id"];
  release.questions[1].title = "x".repeat(301);
  release.domains[0].color = "url(https://tracking.example)";
  assert.ok(
    validatePublishedConfig(release).some((error) =>
      error.includes("catalogue"),
    ),
  );
  assert.ok(
    validatePublishedConfig(release).some((error) =>
      error.includes("text or weight"),
    ),
  );
  assert.ok(
    validatePublishedConfig(release).some((error) =>
      error.includes("six-digit"),
    ),
  );
});
test("frozen calibration covers no-site, contingency, capacity and unknown profiles without mutating releases", () => {
  const before = JSON.stringify(DEFAULT_RELEASE);
  const comparisons = compareConfiguration(
    DEFAULT_RELEASE,
    structuredClone(DEFAULT_RELEASE),
  );
  assert.equal(comparisons.length, 6);
  assert.ok(comparisons.every((item) => item.before === item.after));
  assert.equal(comparisons.find((item) => item.id === "unknown")!.after, null);
  assert.equal(
    comparisons
      .find((item) => item.id === "prelaunch")!
      .domainChanges.find((item) => item.id === "presence")!.after,
    null,
  );
  assert.equal(JSON.stringify(DEFAULT_RELEASE), before);
});
test("calibration reveals eligibility and action changes caused by configuration", () => {
  const draft = structuredClone(DEFAULT_RELEASE);
  draft.questions.find((q) => q.id === "operations-2")!.weight = 10;
  draft.actions.find((a) => a.id === "capacity-first")!.title =
    "Resolve workload first";
  const result = compareConfiguration(DEFAULT_RELEASE, draft);
  assert.notEqual(
    result.find((item) => item.id === "juniper")!.before,
    result.find((item) => item.id === "juniper")!.after,
  );
  assert.equal(
    compareConfiguration(DEFAULT_RELEASE, { ...draft, minCoverage: 0.1 })
      .length,
    0,
  );
});
