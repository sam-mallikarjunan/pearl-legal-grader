import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "./catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "./demo";
import { assessPractice } from "./scoring";
import { type SavedAssessment } from "./storage";
import { ACCOUNT_CONSENT_VERSION } from "./account/types";
import {
  AccountDataError,
  canonicalJson,
  parseAccountReport,
  parsePreferencesUpdate,
  parseProgressUpdate,
} from "./account/validation";

export function accountTestReport(): SavedAssessment {
  return {
    id: "13be04bb-5fc0-4558-a171-bb2c65e934f7",
    practiceId: "631a03e4-12db-4244-be83-cdf017d4c17c",
    createdAt: "2026-10-15T20:00:00.000Z",
    label: "Account test practice",
    isSample: false,
    assessment: assessPractice({
      context: SAMPLE_CONTEXT,
      answers: SAMPLE_ANSWERS,
      controls: SAMPLE_CONTROLS,
      release: DEFAULT_RELEASE,
    }),
  };
}
function errorCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) =>
      error instanceof AccountDataError && error.code === code,
  );
}
test("account report uses a trusted release and reproducible score, independent of JSON field order", () => {
  const report = accountTestReport();
  const parsed = parseAccountReport({ report });
  assert.deepEqual(parsed.report, report);
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assert.deepEqual(parsed.actionStates, {});
  assert.deepEqual(parsed.actionProgress, {});
});
test("account report rejects fictional examples, local identifiers, unsupported fields and embedded credentials", () => {
  for (const change of [
    (report: SavedAssessment) => {
      report.isSample = true;
    },
    (report: SavedAssessment) => {
      report.id = "sample-assessment";
    },
    (report: SavedAssessment) => {
      report.practiceId = "sample-juniper";
    },
  ]) {
    const report = accountTestReport();
    change(report);
    errorCode(() => parseAccountReport({ report }), "invalid_report");
  }
  errorCode(
    () =>
      parseAccountReport({
        report: { ...accountTestReport(), accessToken: "do-not-persist" },
      }),
    "invalid_report",
  );
  errorCode(
    () =>
      parseAccountReport({
        report: accountTestReport(),
        ownerUserId: "attacker-selected",
      }),
    "invalid_fields",
  );
});
test("matching release ID cannot authorize changed weights or forged computed scores", () => {
  const report = accountTestReport();
  report.assessment = structuredClone(report.assessment);
  report.assessment.releaseSnapshot.domains[0].weight += 1;
  errorCode(() => parseAccountReport({ report }), "noncanonical_release");
  const forged = accountTestReport();
  forged.assessment = structuredClone(forged.assessment);
  forged.assessment.overallScore = 99;
  errorCode(
    () => parseAccountReport({ report: forged }),
    "noncanonical_scores",
  );
});
test("an explicitly trusted historical release can reproduce its issued report", () => {
  const historical = structuredClone(DEFAULT_RELEASE);
  historical.id = "approved-history-test";
  historical.domains[0].weight += 1;
  const report = accountTestReport();
  report.assessment = assessPractice({
    context: SAMPLE_CONTEXT,
    answers: SAMPLE_ANSWERS,
    controls: SAMPLE_CONTROLS,
    release: historical,
  });
  assert.deepEqual(parseAccountReport({ report }, historical).report, report);
  errorCode(() => parseAccountReport({ report }), "noncanonical_release");
});
test("account action updates preserve separate bounded progress and reject unrelated action IDs", () => {
  const report = accountTestReport();
  const actionId = report.assessment.actions[0].id;
  const details = {
    updatedAt: "2026-10-15T20:01:00.000Z",
    targetDate: "2026-10-30",
    outcome: { status: "unsure", recordedAt: "2026-10-15T20:01:00.000Z" },
  };
  const saved = parseAccountReport({
    report,
    actionStates: { [actionId]: "in_progress" },
    actionProgress: { [actionId]: details },
  });
  assert.equal(saved.actionStates[actionId], "in_progress");
  assert.deepEqual(saved.report.assessment, report.assessment);
  assert.deepEqual(
    parseProgressUpdate({
      actionId,
      state: "not_relevant",
      revision: 0,
      details,
    }),
    { actionId, state: "not_relevant", revision: 0, details },
  );
  errorCode(
    () => parseAccountReport({ report, actionStates: { unrelated: "done" } }),
    "invalid_progress",
  );
  errorCode(
    () => parseProgressUpdate({ actionId, state: "done", revision: -1 }),
    "invalid_progress",
  );
  errorCode(
    () =>
      parseProgressUpdate({
        actionId,
        state: "done",
        revision: 0,
        details: { ...details, secret: "never" },
      }),
    "invalid_progress",
  );
});
test("account preferences require a fresh explicit version and all four independent values", () => {
  const values = {
    reminders: false,
    marketing: false,
    benchmarking: false,
    leaderboard: false,
  };
  assert.deepEqual(
    parsePreferencesUpdate({
      revision: 0,
      preferences: values,
      consentVersion: ACCOUNT_CONSENT_VERSION,
    }).preferences,
    values,
  );
  errorCode(
    () =>
      parsePreferencesUpdate({
        revision: 0,
        preferences: values,
        consentVersion: "old-local-interest",
      }),
    "invalid_preferences",
  );
  errorCode(
    () =>
      parsePreferencesUpdate({
        revision: 0,
        preferences: { marketing: true },
        consentVersion: ACCOUNT_CONSENT_VERSION,
      }),
    "invalid_preferences",
  );
  errorCode(
    () =>
      parsePreferencesUpdate({
        revision: 0,
        preferences: { ...values, consent: true },
        consentVersion: ACCOUNT_CONSENT_VERSION,
      }),
    "invalid_fields",
  );
});
