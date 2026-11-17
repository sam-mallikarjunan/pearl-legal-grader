import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RELEASE } from "./catalog";
import {
  buildCallbackPlaybook,
  CALLBACK_ACTION_IDS,
  CALLBACK_QUEUE_HEADINGS,
  callbackTimeliness,
  DEFAULT_CALLBACK_SETUP,
} from "./missed-call-playbook";

test("the portable routine carries the chosen coverage, trigger, limit and neutral scripts", () => {
  const solo = buildCallbackPlaybook(DEFAULT_CALLBACK_SETUP);
  const team = buildCallbackPlaybook({
    coverage: "team",
    target: "30",
    retry: true,
  });
  assert.match(solo, /within 1 covered hour/);
  assert.match(solo, /close this follow-up unless they ask/);
  assert.match(team, /within 30 covered minutes/);
  assert.match(team, /named backup takes over/);
  assert.match(team, /at most one more attempt on the next covered day/);
  for (const artifact of [solo, team]) {
    assert.match(artifact, /next covered opening/);
    assert.match(artifact, /opted out, wrong number, unsafe to contact/);
    assert.match(
      artifact,
      /Neutral voicemail, only if permitted and safe:.*\[approved office number\]/,
    );
    assert.match(
      artifact,
      /late and never-called eligible calls in the denominator/,
    );
    assert.match(
      artifact,
      /Keep all caller, contact and matter records out of the grader/,
    );
    assert.ok(artifact.includes(CALLBACK_QUEUE_HEADINGS.join(" | ")));
  }
  assert.ok(
    CALLBACK_ACTION_IDS.every((id) =>
      DEFAULT_RELEASE.actions.some((a) => a.id === id),
    ),
  );
});

test("a process rate uses all eligible calls, keeps no denominator distinct, and rejects impossible counts", () => {
  assert.deepEqual(callbackTimeliness("8", "6"), {
    status: "measured",
    total: 8,
    onTime: 6,
    ratio: 0.75,
  });
  assert.deepEqual(callbackTimeliness("8", "0"), {
    status: "measured",
    total: 8,
    onTime: 0,
    ratio: 0,
  });
  assert.deepEqual(callbackTimeliness("0", "0"), { status: "empty" });
  for (const [eligible, timely] of [
    ["0", "1"],
    ["8", "9"],
    ["-8", "6"],
    ["8", "1.5"],
    ["", "1"],
    ["1000001", "6"],
    ["8e1", "6"],
  ]) {
    assert.deepEqual(callbackTimeliness(eligible, timely), {
      status: "invalid",
    });
  }
});
