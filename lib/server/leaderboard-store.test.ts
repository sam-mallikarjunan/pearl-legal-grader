import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "../catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "../demo";
import { assessPractice } from "../scoring";
import {
  LEADERBOARD_CONSENT_TEXT,
  LEADERBOARD_POLICY_VERSION,
  type LeaderboardCandidate,
} from "../leaderboard";
import type { CloudReport } from "../account/types";
import { configurationHash } from "./config-store";
import {
  createLeaderboardStore,
  LeaderboardServiceError,
} from "./leaderboard-store";
const user = "00000000-0000-4000-8000-000000000001",
  id = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-10-19T15:00:00.000Z");
const report: CloudReport = {
  id,
  canonical: true,
  savedAt: now.toISOString(),
  actionProgress: [],
  snapshot: {
    id: "00000000-0000-4000-8000-000000000003",
    practiceId: "00000000-0000-4000-8000-000000000004",
    createdAt: "2026-10-19T12:00:00.000Z",
    label: "Private firm",
    isSample: false,
    assessment: assessPractice({
      context: SAMPLE_CONTEXT,
      answers: SAMPLE_ANSWERS,
      controls: SAMPLE_CONTROLS,
      release: DEFAULT_RELEASE,
    }),
  },
};
const state = {
  published: true,
  alias: "Practice-123456789ABC",
  reportId: id,
  revision: 1,
  updatedAt: now.toISOString(),
};
function store(
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  read = async (_user: string, _id: string) => structuredClone(report),
) {
  return createLeaderboardStore({
    rpc: (name, args = {}) => rpc(name, args),
    activeConfig: async () => ({
      release: DEFAULT_RELEASE,
      contentHash: configurationHash(DEFAULT_RELEASE),
      publishedAt: null,
      source: "default",
      available: true,
    }),
    reports: async () => [structuredClone(report)],
    report: read,
    alias: () => state.alias,
    now: () => now,
  });
}
test("publish derives ownership, alias and consent server-side and pins the selected report", async () => {
  let called = false;
  const api = store(
    async (name, args) => {
      called = true;
      assert.equal(name, "grader_leaderboard_publish");
      assert.equal(args.p_user_id, user);
      assert.equal(args.p_report_id, id);
      assert.equal(args.p_revision, 0);
      assert.equal(args.p_alias, state.alias);
      assert.equal(args.p_consent_version, LEADERBOARD_POLICY_VERSION);
      assert.equal(args.p_consent_text, LEADERBOARD_CONSENT_TEXT);
      assert.equal("score" in args, false);
      return state;
    },
    async (uid, rid) => {
      assert.equal(uid, user);
      assert.equal(rid, id);
      return report;
    },
  );
  assert.equal(
    (await api.publish(user, { reportId: id, revision: 0, consent: true }))
      .published,
    true,
  );
  assert.equal(called, true);
});
test("interest or false consent cannot enroll, and forged or foreign reports never reach publication", async () => {
  let calls = 0;
  const api = store(async () => {
    calls++;
    return state;
  });
  for (const body of [
    { reportId: id, revision: 0 },
    { reportId: id, revision: 0, consent: false },
    { reportId: id, revision: 0, consent: true, score: 100 },
  ])
    await assert.rejects(
      api.publish(user, body),
      (e: unknown) => e instanceof LeaderboardServiceError && e.status === 400,
    );
  const forged = structuredClone(report);
  forged.snapshot.assessment.overallScore = 100;
  await assert.rejects(
    store(
      async () => {
        calls++;
        return state;
      },
      async () => forged,
    ).publish(user, { reportId: id, revision: 0, consent: true }),
  );
  await assert.rejects(
    store(
      async () => {
        calls++;
        return state;
      },
      async () => ({ ...report, id: user }),
    ).publish(user, { reportId: id, revision: 0, consent: true }),
  );
  assert.equal(calls, 0);
});
test("withdrawal uses verified owner and CAS, and conflicts remain explicit", async () => {
  const api = store(async (name, args) => {
    assert.equal(name, "grader_leaderboard_withdraw");
    assert.equal(args.p_user_id, user);
    assert.equal(args.p_revision, 1);
    return { ...state, published: false, revision: 2 };
  });
  assert.equal((await api.withdraw(user, { revision: 1 })).published, false);
  await assert.rejects(
    store(async () => ({ error: "revision_conflict" })).withdraw(user, {
      revision: 0,
    }),
    (e: unknown) => e instanceof LeaderboardServiceError && e.status === 409,
  );
});
test("public read rechecks current consent and exact revision/selection before serialization", async () => {
  const candidates: LeaderboardCandidate[] = Array.from(
    { length: 10 },
    (_, i) => ({
      workspaceId: `00000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`,
      reportId: id,
      alias: `Practice-${String(i).padStart(12, "0")}`,
      published: true,
      consentVersion: LEADERBOARD_POLICY_VERSION,
      revision: 1,
      report: report.snapshot,
    }),
  );
  let page = 0;
  const api = store(async (name, args) => {
    if (name === "grader_leaderboard_source_page")
      return page++ === 0 ? candidates : [];
    assert.equal(name, "grader_leaderboard_current_publications");
    const selections = args.p_selections as Record<string, unknown>[];
    assert.equal(selections.length, 10);
    assert.deepEqual(selections[0], {
      workspaceId: candidates[0].workspaceId,
      reportId: id,
      revision: 1,
    });
    return candidates.slice(1).map((c) => c.workspaceId);
  });
  const board = await api.publicView();
  assert.equal(
    board.cohorts.some((c) => c.status === "ranked"),
    false,
  );
  assert.equal(JSON.stringify(board).includes(candidates[0].alias), false);
});
test("private export includes only owner enrollment and selected consent history", async () => {
  const api = store(async (name, args) => {
    assert.equal(name, "grader_leaderboard_export_own");
    assert.equal(args.p_user_id, user);
    return {
      enrollment: state,
      consentEvents: [
        {
          action: "published",
          reportId: id,
          consentVersion: LEADERBOARD_POLICY_VERSION,
          consentText: LEADERBOARD_CONSENT_TEXT,
          recordedAt: now.toISOString(),
          workspaceId: user,
        },
      ],
      historyTruncated: false,
    };
  });
  const out = await api.exportOwn(user);
  assert.equal(out.enrollment.alias, state.alias);
  assert.equal("workspaceId" in out.consentEvents[0], false);
});
