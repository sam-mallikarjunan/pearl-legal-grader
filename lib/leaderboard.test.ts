import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "./catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "./demo";
import { assessPractice } from "./scoring";
import {
  LEADERBOARD_POLICY_VERSION,
  leaderboardEligibility,
  parseLeaderboardPublish,
  publicLeaderboard,
  type LeaderboardCandidate,
} from "./leaderboard";
import type { SavedAssessment } from "./storage";
const now = new Date("2026-10-19T15:00:00.000Z");
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function candidate(n = 1): LeaderboardCandidate {
  return {
    workspaceId: uuid(n),
    reportId: uuid(n + 100),
    alias: `Practice-${n.toString(16).toUpperCase().padStart(12, "0")}`,
    published: true,
    consentVersion: LEADERBOARD_POLICY_VERSION,
    revision: 1,
    report: {
      id: uuid(n + 200),
      practiceId: uuid(n + 300),
      createdAt: "2026-10-19T12:00:00.000Z",
      label: "Private firm owner",
      isSample: false,
      assessment: structuredClone(
        assessPractice({
          context: {
            ...SAMPLE_CONTEXT,
            practiceArea: "Sensitive practice",
            jurisdiction: "Private location",
            websiteUrl: "https://private.example",
          },
          answers: SAMPLE_ANSWERS,
          controls: SAMPLE_CONTROLS,
          release: DEFAULT_RELEASE,
        }),
      ),
    },
  };
}
test("public publication requires fresh explicit consent and rejects supplied scoring or identity fields", () => {
  const body = { reportId: uuid(1), revision: 0, consent: true };
  assert.deepEqual(parseLeaderboardPublish(body), {
    reportId: uuid(1),
    revision: 0,
  });
  for (const patch of [
    { consent: false },
    { consent: undefined },
    { leaderboard: true },
    { score: 100 },
    { workspaceId: uuid(2) },
    { alias: "Private Firm" },
  ])
    assert.equal(parseLeaderboardPublish({ ...body, ...patch }), null);
});
test("9 entries expose no scores or exact small count; 10 expose only anonymous scores and tied ranks", () => {
  const nine = publicLeaderboard(
    Array.from({ length: 9 }, (_, n) => candidate(n + 1)),
    DEFAULT_RELEASE,
    now,
  );
  assert.equal(
    nine.cohorts.some((c) => c.status === "ranked"),
    false,
  );
  assert.equal(
    nine.cohorts.every((c) => c.entryCount === null && c.entries.length === 0),
    true,
  );
  const ten = publicLeaderboard(
    Array.from({ length: 10 }, (_, n) => candidate(n + 1)),
    DEFAULT_RELEASE,
    now,
  );
  const cohort = ten.cohorts.find((c) => c.status === "ranked")!;
  assert.equal(cohort.entryCount, 10);
  assert.equal(
    cohort.entries.every((e) => e.rank === 1),
    true,
  );
  const encoded = JSON.stringify(ten);
  for (const value of [
    "private.example",
    "Private firm",
    "Sensitive practice",
    "Private location",
    uuid(1),
    "reportId",
    "workspaceId",
    "answersSnapshot",
    "createdAt",
  ])
    assert.equal(encoded.includes(value), false, value);
});
test("withdrawal, legacy interest, duplicates and changed consent cannot boost participation", () => {
  const rows = Array.from({ length: 10 }, (_, n) => candidate(n + 1));
  rows[0].published = false;
  assert.equal(
    publicLeaderboard(rows, DEFAULT_RELEASE, now).cohorts.some(
      (c) => c.status === "ranked",
    ),
    false,
  );
  rows[0].published = true;
  rows[0].consentVersion = "account-preferences-v1";
  assert.equal(
    publicLeaderboard(rows, DEFAULT_RELEASE, now).cohorts.some(
      (c) => c.status === "ranked",
    ),
    false,
  );
  rows[0].consentVersion = LEADERBOARD_POLICY_VERSION;
  assert.equal(
    publicLeaderboard(
      [...rows, candidate(1)],
      DEFAULT_RELEASE,
      now,
    ).cohorts.some((c) => c.status === "ranked"),
    false,
  );
});
test("stale, sample, forged scores, mixed release, insufficient coverage and truncated reads cannot rank", () => {
  for (const [patch, reason] of [
    [{ createdAt: "2026-01-01T12:00:00.000Z" }, "stale"],
    [{ isSample: true }, "sample"],
  ] as const) {
    const row = candidate();
    Object.assign(row.report as object, patch);
    assert.deepEqual(leaderboardEligibility(row.report, DEFAULT_RELEASE, now), {
      eligible: false,
      reason,
    });
  }
  const forged = candidate();
  (forged.report as SavedAssessment).assessment.overallScore = 100;
  assert.deepEqual(
    leaderboardEligibility(forged.report, DEFAULT_RELEASE, now),
    { eligible: false, reason: "invalid" },
  );
  const mixed = candidate();
  (mixed.report as SavedAssessment).assessment.releaseId = "other";
  assert.deepEqual(leaderboardEligibility(mixed.report, DEFAULT_RELEASE, now), {
    eligible: false,
    reason: "different_release",
  });
  const low = candidate();
  (low.report as SavedAssessment).assessment = assessPractice({
    context: SAMPLE_CONTEXT,
    answers: {},
    controls: SAMPLE_CONTROLS,
    release: DEFAULT_RELEASE,
  });
  assert.deepEqual(leaderboardEligibility(low.report, DEFAULT_RELEASE, now), {
    eligible: false,
    reason: "insufficient_evidence",
  });
  assert.equal(
    publicLeaderboard(
      Array.from({ length: 30 }, (_, n) => candidate(n + 1)),
      DEFAULT_RELEASE,
      now,
      true,
    ).cohorts.some((c) => c.status === "ranked"),
    false,
  );
});

test("cohorts never mix fee models and 29 public opt-ins do not invent peer percentiles", () => {
  const rows = Array.from({ length: 10 }, (_, i) => candidate(i + 1));
  for (const row of rows.slice(5)) {
    const saved = row.report as SavedAssessment;
    saved.assessment = assessPractice({
      context: { ...saved.assessment.contextSnapshot, feeModel: "hourly" },
      answers: SAMPLE_ANSWERS,
      controls: SAMPLE_CONTROLS,
      release: DEFAULT_RELEASE,
    });
  }
  assert.equal(
    publicLeaderboard(rows, DEFAULT_RELEASE, now).cohorts.some(
      (c) => c.status === "ranked",
    ),
    false,
  );
  const board = publicLeaderboard(
    Array.from({ length: 29 }, (_, i) => candidate(i + 1)),
    DEFAULT_RELEASE,
    now,
  );
  assert.equal(
    board.cohorts.find((c) => c.status === "ranked")?.entryCount,
    29,
  );
  assert.equal(
    board.cohorts
      .flatMap((c) => c.entries)
      .some((entry) => "percentile" in entry),
    false,
  );
});
