import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { DEFAULT_RELEASE } from "../catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "../demo";
import { assessPractice } from "../scoring";
import { DOMAIN_IDS } from "../types";
import {
  createCalibrationStore,
  CalibrationUnavailable,
  parseCalibrationExperiment,
} from "./calibration-store";
import { configurationHash } from "./config-store";
import { GET, POST } from "../../app/api/admin/calibration/route";
const now = new Date("2026-10-19T12:00:00.000Z");
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const active = () => ({
  release: DEFAULT_RELEASE,
  contentHash: configurationHash(DEFAULT_RELEASE),
  publishedAt: null,
  source: "published" as const,
  available: true as const,
});
const weights = Object.fromEntries(DOMAIN_IDS.map((id) => [id, 1]));
function candidate(n: number) {
  return {
    workspaceId: uuid(n),
    benchmarking: true,
    outcomeResearch: true,
    periods: [
      {
        id: uuid(1000 + n),
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        source: "self_reported",
        currency: "USD",
        baselineReportId: uuid(2000 + n),
        inquiries: 100,
        contacted: 80,
        booked: 40,
        attended: 30,
        clients: 20,
        leadSpendMinor: null,
        cohortBilledMinor: 10000,
        cohortCollectedMinor: 9000,
        adminHours: 30,
      },
    ],
    baselines: [
      {
        id: uuid(2000 + n),
        savedAt: "2026-08-31T12:30:00.000Z",
        report: {
          id: uuid(3000 + n),
          practiceId: uuid(4000 + n),
          createdAt: "2026-08-31T12:00:00.000Z",
          label: "Do not expose owner label",
          isSample: false,
          assessment: structuredClone(
            assessPractice({
              context: SAMPLE_CONTEXT,
              answers: SAMPLE_ANSWERS,
              controls: SAMPLE_CONTROLS,
              release: DEFAULT_RELEASE,
            }),
          ),
        },
      },
    ],
  };
}
const pseudonym = (id: string) => createHash("sha256").update(id).digest("hex");
test("store loads bounded ordered pages, rechecks both permissions, and returns aggregates only", async () => {
  const data = Array.from({ length: 30 }, (_, i) => candidate(i + 1));
  const names: string[] = [];
  const store = createCalibrationStore({
    activeConfig: async () => active(),
    pseudonym,
    now: () => now,
    rpc: async (name, args = {}) => {
      names.push(name);
      if (name === "grader_outcome_research_source_page") {
        assert.equal(args.p_limit, 2);
        assert.equal(args.p_release_id, DEFAULT_RELEASE.id);
        return data
          .filter((c) => !args.p_after || c.workspaceId > String(args.p_after))
          .slice(0, 2);
      }
      if (name === "grader_outcome_research_current_consent")
        return data.map((c) => c.workspaceId);
      throw new Error("Unexpected mutation");
    },
  });
  const result = await store.summary();
  assert.equal(result.status, "descriptive");
  assert.equal(result.cohorts.length, 1);
  assert.equal(names.at(-1), "grader_outcome_research_current_consent");
  const json = JSON.stringify(result);
  for (const forbidden of [uuid(1), "Do not expose"])
    assert.equal(json.includes(forbidden), false, forbidden);
  for (const field of ["workspaceKey", "periods", "cohortBilledMinor"])
    assert.equal(json.includes(`"${field}":`), false, field);
});
test("permission withdrawn during the read removes that workspace before thresholding", async () => {
  const data = Array.from({ length: 30 }, (_, i) => candidate(i + 1));
  const store = createCalibrationStore({
    activeConfig: async () => active(),
    pseudonym,
    now: () => now,
    rpc: async (name, args = {}) =>
      name === "grader_outcome_research_current_consent"
        ? data.slice(1).map((c) => c.workspaceId)
        : data
            .filter(
              (c) => !args.p_after || c.workspaceId > String(args.p_after),
            )
            .slice(0, 2),
  });
  const result = await store.summary();
  assert.equal(result.status, "forming");
  assert.deepEqual(result.cohorts, []);
});
test("invalid page size, cursor order or consent recheck cannot escape as a partial cohort", async () => {
  for (const kind of ["oversized", "duplicate", "unpermitted-id"] as const) {
    const store = createCalibrationStore({
      activeConfig: async () => active(),
      pseudonym,
      now: () => now,
      rpc: async (name) => {
        if (name === "grader_outcome_research_current_consent")
          return [uuid(999)];
        if (kind === "oversized")
          return [candidate(1), candidate(2), candidate(3)];
        if (kind === "duplicate") return [candidate(1), candidate(1)];
        return [candidate(1)];
      },
    });
    await assert.rejects(store.summary(), CalibrationUnavailable);
  }
});
test("200-workspace source ceiling suppresses every statistic from a truncated scan", async () => {
  const store = createCalibrationStore({
    activeConfig: async () => active(),
    pseudonym,
    now: () => now,
    rpc: async (name, args = {}) => {
      if (name === "grader_outcome_research_current_consent")
        return args.p_workspace_ids;
      const n = args.p_after ? Number(String(args.p_after).slice(-12)) : 0;
      return [candidate(n + 1), candidate(n + 2)];
    },
  });
  const result = await store.summary();
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.cohorts, []);
  assert.equal(result.sourceWorkspaces, null);
});
test("candidate request cannot pick a different release, filter, participant or unsupported weight", async () => {
  assert.throws(() =>
    parseCalibrationExperiment({
      expectedReleaseId: DEFAULT_RELEASE.id,
      weights,
      workspaceId: uuid(1),
    }),
  );
  assert.throws(() =>
    parseCalibrationExperiment({
      expectedReleaseId: DEFAULT_RELEASE.id,
      weights: { ...weights, cash: 0 },
    }),
  );
  const experiment = parseCalibrationExperiment({
    expectedReleaseId: "other-version",
    weights,
  });
  const store = createCalibrationStore({
    activeConfig: async () => active(),
    pseudonym,
    rpc: async () => {
      throw new Error("Must not read source");
    },
  });
  await assert.rejects(
    store.summary(experiment),
    (e: unknown) =>
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      e.code === "calibration_release_changed",
  );
});
test("a publication changing during an analysis returns a conflict instead of mixing releases", async () => {
  let reads = 0;
  const store = createCalibrationStore({
    activeConfig: async () => {
      reads++;
      return reads === 1
        ? active()
        : { ...active(), contentHash: "f".repeat(64) };
    },
    pseudonym,
    rpc: async () => [],
  });
  await assert.rejects(
    store.summary(),
    (e: unknown) =>
      typeof e === "object" && e !== null && "status" in e && e.status === 409,
  );
});
test("calibration routes require operator authentication and same-origin candidate requests", async () => {
  const original = process.env.ACCOUNTS_ENABLED;
  process.env.ACCOUNTS_ENABLED = "false";
  try {
    assert.equal(
      (await GET(new Request("https://grader.example/api/admin/calibration")))
        .status,
      401,
    );
    for (const headers of [
      {},
      { origin: "https://evil.example" },
      { origin: "https://grader.example", "sec-fetch-site": "cross-site" },
    ])
      assert.equal(
        (
          await POST(
            new Request("https://grader.example/api/admin/calibration", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...headers,
              } as Record<string, string>,
              body: JSON.stringify({
                expectedReleaseId: DEFAULT_RELEASE.id,
                weights,
              }),
            }),
          )
        ).status,
        403,
      );
  } finally {
    if (original === undefined) delete process.env.ACCOUNTS_ENABLED;
    else process.env.ACCOUNTS_ENABLED = original;
  }
});
