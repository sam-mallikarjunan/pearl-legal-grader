import { strict as assert } from "node:assert";
import { test } from "node:test";
import { actionObservationFixtures } from "./action-observation-test-fixtures";
import {
  accountProgressDiffers,
  mergeAccountProgress,
} from "./account-device-progress";
import { emptyStore } from "./storage";
import type { CloudActionProgress } from "./account/types";

function fixture() {
  const { report } = actionObservationFixtures();
  const store = emptyStore();
  store.assessments = [report.snapshot];
  const actionId = report.snapshot.assessment.actions[0].id;
  const key = `${report.snapshot.id}:${actionId}`;
  const cloud: CloudActionProgress[] = [
    {
      actionId,
      state: "in_progress",
      revision: 1,
      updatedAt: "2026-11-18T12:00:00Z",
      details: { updatedAt: "2026-11-18T12:00:00Z", targetDate: "2026-12-01" },
    },
  ];
  return { report: report.snapshot, store, actionId, key, cloud };
}

test("default account import keeps a differing device state and its details together", () => {
  const f = fixture();
  f.store.actionStates[f.key] = "done";
  f.store.actionProgress = { [f.key]: { updatedAt: "2026-11-17T12:00:00Z" } };
  assert.equal(accountProgressDiffers(f.store, f.report, f.cloud), true);
  const before = structuredClone(f.store);
  const result = mergeAccountProgress(f.store, f.report, f.cloud);
  assert.equal(result.actionStates[f.key], "done");
  assert.deepEqual(
    result.actionProgress?.[f.key],
    before.actionProgress?.[f.key],
  );
  assert.deepEqual(f.store, before);
});

test("explicit account choice copies known account progress and clears details absent from the account", () => {
  const f = fixture();
  f.store.actionStates[f.key] = "done";
  f.store.actionProgress = {
    [f.key]: { updatedAt: "2026-11-17T12:00:00Z", targetDate: "2026-11-19" },
  };
  const copied = mergeAccountProgress(f.store, f.report, f.cloud, true);
  assert.equal(copied.actionStates[f.key], "in_progress");
  assert.deepEqual(copied.actionProgress?.[f.key], f.cloud[0].details);
  const cleared = mergeAccountProgress(f.store, f.report, [], true);
  assert.equal(cleared.actionStates[f.key], "todo");
  assert.equal(cleared.actionProgress?.[f.key], undefined);
});

test("account choice preserves unrelated report data and ignores unissued action rows", () => {
  const f = fixture();
  const unrelated = "other-report:other-action";
  f.store.actionStates[unrelated] = "done";
  f.store.actionProgress = {
    [unrelated]: { updatedAt: "2026-11-17T12:00:00Z" },
  };
  const result = mergeAccountProgress(
    f.store,
    f.report,
    [...f.cloud, { ...f.cloud[0], actionId: "unissued-action" }],
    true,
  );
  assert.equal(result.actionStates[unrelated], "done");
  assert.deepEqual(
    result.actionProgress?.[unrelated],
    f.store.actionProgress[unrelated],
  );
  assert.equal(
    result.actionStates[`${f.report.id}:unissued-action`],
    undefined,
  );
});

test("a new device copy has no conflict and imports account progress without a replacement choice", () => {
  const f = fixture();
  f.store.assessments = [];
  assert.equal(accountProgressDiffers(f.store, f.report, f.cloud), false);
  const merged = mergeAccountProgress(f.store, f.report, f.cloud);
  assert.equal(merged.actionStates[f.key], "in_progress");
  assert.deepEqual(merged.actionProgress?.[f.key], f.cloud[0].details);
});
