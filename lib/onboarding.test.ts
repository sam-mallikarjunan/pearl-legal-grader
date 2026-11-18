import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseOnboardingPreferences } from "./onboarding";

test("tour preferences contain only bounded local completion and dismissal choices", () => {
  assert.deepEqual(parseOnboardingPreferences(null), { version: 1, tours: {} });
  const expected = {
    version: 1,
    tours: { "grader-start-v1": "dismissed", "workspace-v1": "completed" },
  };
  assert.deepEqual(
    parseOnboardingPreferences(JSON.stringify(expected)),
    expected,
  );
});
test("unreadable, newer, inherited and oversized tour records are preserved rather than coerced", () => {
  for (const raw of [
    "{",
    "[]",
    '{"version":2,"tours":{}}',
    '{"version":1,"tours":{"constructor":"completed"}}',
    '{"version":1,"tours":{"__proto__":"completed"}}',
    '{"version":1,"tours":{"home":"started"}}',
    '{"version":1,"tours":{},"answers":{}}',
    " ".repeat(8193),
    JSON.stringify({
      version: 1,
      tours: Object.fromEntries(
        Array.from({ length: 31 }, (_, i) => [`tour-${i}`, "completed"]),
      ),
    }),
  ])
    assert.equal(parseOnboardingPreferences(raw), null);
});
