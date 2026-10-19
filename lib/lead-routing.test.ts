import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  LEAD_ROUTING_CONSENT_TEXT,
  LEAD_ROUTING_CONSENT_VERSION,
  safeRoutingSummary,
  validRoutingEmail,
} from "./lead-routing";
test("contact permission explicitly covers the private queue without external CRM or marketing authorization", () => {
  assert.equal(LEAD_ROUTING_CONSENT_VERSION, "requested-pearl-help-v2");
  assert.match(LEAD_ROUTING_CONSENT_TEXT, /private follow-up queue/);
  assert.match(LEAD_ROUTING_CONSENT_TEXT, /separate from optional marketing/);
  assert.equal(
    /HubSpot|external CRM|automatically email/.test(LEAD_ROUTING_CONSENT_TEXT),
    false,
  );
});
test("optional report summary excludes every private or freeform field", () => {
  const summary = safeRoutingSummary({
    score: 70.2,
    coveragePercent: 87.5,
    rubricVersion: "preview-r1",
    answersSnapshot: { private: true },
    websiteUrl: "https://private.example",
    outcome: "sensitive",
    jurisdiction: "private",
  });
  assert.deepEqual(summary, {
    score: 70,
    coveragePercent: 88,
    rubricVersion: "preview-r1",
  });
  assert.equal(
    safeRoutingSummary({
      score: Infinity,
      coveragePercent: 80,
      rubricVersion: "release",
    }),
    null,
  );
  assert.equal(
    safeRoutingSummary({
      score: 70,
      coveragePercent: 101,
      rubricVersion: "release",
    }),
    null,
  );
  assert.equal(
    safeRoutingSummary({
      score: 70,
      coveragePercent: 80,
      rubricVersion: "Private firm name",
    }),
    null,
  );
  assert.equal(validRoutingEmail("owner@example.test"), true);
  assert.equal(validRoutingEmail("owner@example.test\nsecret"), false);
});
