import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createAIReviewService,
  AIReviewError,
  generateWebsiteExplanation,
  createAIReviewMaintenance,
} from "./ai-review";
import {
  AI_REVIEW_MODEL,
  AI_REVIEW_PROMPT_VERSION,
  buildAIReviewSources,
} from "../ai-review";
import {
  AI_TEST_DATE,
  AI_TEST_REPORT,
  AI_TEST_USER,
  websiteAIOutputFixture,
  websiteAIReportFixture,
} from "../test-fixtures/website-ai";

const reviewId = "9bc415be-01f9-4f00-bcb8-58b7ef07f492",
  leaseId = "895a72a8-961c-4f60-bcb2-dbfec10b1ee6";
function harness(
  options: {
    enabled?: boolean;
    invalidOutput?: boolean;
    limit?: boolean;
    noWebsite?: boolean;
    providerFailure?: boolean;
  } = {},
) {
  const report = websiteAIReportFixture();
  if (options.noWebsite) delete report.snapshot.websiteScan;
  let cached: unknown = null;
  let calls = 0;
  const sql: Array<{ name: string; args: Record<string, unknown> }> = [];
  const service = createAIReviewService({
    configured: () => options.enabled !== false,
    now: () => new Date(AI_TEST_DATE),
    readReport: async (user, id) => {
      assert.equal(user, AI_TEST_USER);
      assert.equal(id, AI_TEST_REPORT);
      return report;
    },
    rpc: async (name, args = {}) => {
      sql.push({ name, args });
      assert.equal(args.p_user_id, AI_TEST_USER);
      if (name === "grader_read_ai_review") return cached;
      if (name === "grader_reserve_ai_review")
        return options.limit
          ? { error: "ai_account_limit" }
          : cached
            ? { ...(cached as object), start: false }
            : {
                start: true,
                id: reviewId,
                leaseId,
                status: "pending",
                review: null,
              };
      if (name === "grader_finish_ai_review") {
        assert.equal(args.p_review_id, reviewId);
        assert.equal(args.p_lease_id, leaseId);
        cached = {
          id: reviewId,
          status: args.p_review ? "complete" : "unavailable",
          review: args.p_review,
        };
        return true;
      }
      throw new Error("Unexpected RPC");
    },
    generate: async (sources) => {
      calls++;
      if (options.providerFailure)
        throw new Error("secret provider body must not escape");
      const output = websiteAIOutputFixture(sources);
      if (options.invalidOutput)
        output.explanations[0].quote = "This sentence is entirely fabricated";
      return { output, providerModel: AI_REVIEW_MODEL };
    },
  });
  return { service, report, sql, calls: () => calls };
}

test("AI explanation is owner-scoped, cached by source/method/model and cannot mutate grades", async () => {
  const setup = harness();
  const original = JSON.stringify(setup.report);
  const first = await setup.service.create(AI_TEST_USER, AI_TEST_REPORT);
  assert.equal(first.state, "complete");
  assert.equal(first.cached, false);
  assert.equal(first.review!.promptVersion, AI_REVIEW_PROMPT_VERSION);
  assert.equal(first.review!.model, AI_REVIEW_MODEL);
  assert.equal(first.review!.createdAt, AI_TEST_DATE);
  assert.match(first.review!.sourceHash, /^[a-f0-9]{64}$/);
  const read = await setup.service.read(AI_TEST_USER, AI_TEST_REPORT);
  const repeat = await setup.service.create(AI_TEST_USER, AI_TEST_REPORT);
  assert.equal(read.cached, true);
  assert.equal(repeat.cached, true);
  assert.equal(setup.calls(), 1);
  assert.equal(JSON.stringify(setup.report), original);
  assert.ok(!JSON.stringify(setup.sql).includes("PRIVATE OWNER"));
});
test("disabled, unbacked and over-quota requests never call the AI provider", async () => {
  for (const options of [
    { enabled: false },
    { noWebsite: true },
    { limit: true },
  ]) {
    const setup = harness(options);
    const read = await setup.service.read(AI_TEST_USER, AI_TEST_REPORT);
    if (options.enabled === false) assert.equal(read.state, "disabled");
    if (options.noWebsite) assert.equal(read.state, "ineligible");
    await assert.rejects(
      setup.service.create(AI_TEST_USER, AI_TEST_REPORT),
      (error: unknown) => error instanceof AIReviewError,
    );
    assert.equal(setup.calls(), 0);
  }
});
test("fabricated citations and provider failures yield no generated explanation or raw error disclosure", async () => {
  for (const options of [{ invalidOutput: true }, { providerFailure: true }]) {
    const setup = harness(options);
    await assert.rejects(
      setup.service.create(AI_TEST_USER, AI_TEST_REPORT),
      (error: unknown) =>
        error instanceof AIReviewError &&
        !error.message.includes("secret provider"),
    );
    const finish = setup.sql.find(
      (call) => call.name === "grader_finish_ai_review",
    )!;
    assert.equal(finish.args.p_review, null);
    assert.ok(
      ["invalid_response", "provider_unavailable"].includes(
        finish.args.p_error_code as string,
      ),
    );
    assert.equal(
      (await setup.service.read(AI_TEST_USER, AI_TEST_REPORT)).review,
      null,
    );
  }
});
test("the installed provider adapter sends public excerpts only, with no tools, storage, redirects or automatic retry", async () => {
  const oldFlag = process.env.AI_REVIEW_ENABLED,
    oldKey = process.env.OPENAI_API_KEY;
  process.env.AI_REVIEW_ENABLED = "true";
  process.env.OPENAI_API_KEY = "synthetic-unusable-test-key";
  const sources = buildAIReviewSources(
    websiteAIReportFixture().snapshot.websiteScan!,
  );
  let calls = 0;
  try {
    const generated = await generateWebsiteExplanation(
      sources,
      async (url, init) => {
        calls++;
        assert.equal(String(url), "https://api.openai.com/v1/responses");
        assert.equal(init?.redirect, "error");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, AI_REVIEW_MODEL);
        assert.equal(body.store, false);
        assert.equal(body.max_output_tokens, 1200);
        assert.equal(body.reasoning.effort, "none");
        assert.ok(!body.tools || body.tools.length === 0);
        for (const forbidden of [
          "PRIVATE OWNER",
          "owner@example",
          "answersSnapshot",
          "controlsSnapshot",
          "fictional-law.example",
          "accessToken",
        ])
          assert.equal(
            String(init?.body).includes(forbidden),
            false,
            forbidden,
          );
        return Response.json({
          id: "resp_synthetic",
          model: AI_REVIEW_MODEL,
          created_at: 1792166400,
          status: "completed",
          output: [
            {
              type: "message",
              id: "msg_synthetic",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(websiteAIOutputFixture(sources)),
                  annotations: [],
                },
              ],
            },
          ],
          usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 },
        });
      },
    );
    assert.equal(generated.providerModel, AI_REVIEW_MODEL);
    assert.equal(calls, 1);
    calls = 0;
    await assert.rejects(
      generateWebsiteExplanation(sources, async () => {
        calls++;
        return Response.json(
          { error: { message: "Synthetic transient failure" } },
          { status: 500 },
        );
      }),
    );
    assert.equal(calls, 1, "no automatic retries even for provider errors");
  } finally {
    if (oldFlag === undefined) delete process.env.AI_REVIEW_ENABLED;
    else process.env.AI_REVIEW_ENABLED = oldFlag;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test("AI exports include only owned explanations and consent, while cleanup validates counts", async () => {
  const setup = harness();
  const result = await setup.service.create(AI_TEST_USER, AI_TEST_REPORT);
  const row = {
    reportId: AI_TEST_REPORT,
    status: "complete",
    requestedAt: AI_TEST_DATE,
    completedAt: AI_TEST_DATE,
    consentVersion: "ai-public-excerpts-v1",
    consentText: "Synthetic recorded consent",
    review: result.review,
  };
  const calls: string[] = [];
  const maintenance = createAIReviewMaintenance(async (name, args) => {
    calls.push(name);
    if (name === "grader_export_ai_reviews") {
      assert.deepEqual(args, { p_user_id: AI_TEST_USER });
      return [row];
    }
    assert.equal(name, "grader_purge_ai_review_usage");
    return { attemptsRemoved: 2, staleMarked: 1 };
  });
  assert.deepEqual(await maintenance.exportReviews(AI_TEST_USER), [row]);
  assert.deepEqual(await maintenance.purgeUsage(), {
    attemptsRemoved: 2,
    staleMarked: 1,
  });
  await assert.rejects(maintenance.exportReviews("unverified-user"));
  assert.equal(calls.length, 2, "invalid identity never reaches the database");
  for (const invalid of [
    [{ ...row, leaseId }],
    [{ ...row, review: { ...row.review, sourceHash: "forged" } }],
  ])
    await assert.rejects(
      createAIReviewMaintenance(async () => invalid).exportReviews(
        AI_TEST_USER,
      ),
    );
  await assert.rejects(
    createAIReviewMaintenance(async () => ({
      attemptsRemoved: -1,
      staleMarked: 0,
    })).purgeUsage(),
  );
});
