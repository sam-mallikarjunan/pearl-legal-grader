import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "../catalog";
import { configurationHash } from "./config-store";
import {
  createPracticeBenchmarkStore,
  PracticeBenchmarksUnavailable,
} from "./practice-benchmark-store";
import {
  PRACTICE_FIXTURE_NOW as now,
  practiceFixtureKey as key,
  practiceFixtureUuid as uuid,
  practiceSourceFixture as source,
} from "../test-fixtures/practice-benchmarks";
import { GET } from "../../app/api/practice-benchmarks/route";
const active = () => ({
  release: structuredClone(DEFAULT_RELEASE),
  contentHash: configurationHash(DEFAULT_RELEASE),
  available: true as const,
  source: "published" as const,
  publishedAt: null,
});
const data = () => Array.from({ length: 30 }, (_, i) => source(i + 1));
test("private consent upper bound avoids source loading below 30 without publishing any count", async () => {
  let reads = 0;
  const store = createPracticeBenchmarkStore({
    activeConfig: async () => active(),
    counts: async () => ({ benchmarkingConsent: 29 }),
    pseudonym: key,
    now: () => now,
    rpc: async () => {
      reads++;
      throw new Error("No source access authorized by this test");
    },
  });
  const result = await store.summary();
  assert.equal(reads, 0);
  assert.equal(result.status, "forming");
  assert.deepEqual(result.cohorts, []);
  assert.equal(JSON.stringify(result).includes("benchmarkingConsent"), false);
});
test("complete fixed source pagination and current dual permission recheck yield aggregate-only public projection", async () => {
  const rows = data(),
    names: string[] = [];
  let configReads = 0;
  const store = createPracticeBenchmarkStore({
    activeConfig: async () => {
      configReads++;
      return active();
    },
    counts: async () => ({ benchmarkingConsent: 30 }),
    pseudonym: key,
    now: () => now,
    rpc: async (name, args = {}) => {
      names.push(name);
      if (name === "grader_outcome_research_current_consent")
        return rows.map((r) => r.workspaceId);
      assert.equal(name, "grader_outcome_research_source_page");
      assert.equal(args.p_limit, 2);
      assert.equal(args.p_release_id, DEFAULT_RELEASE.id);
      return rows
        .filter((r) => !args.p_after || r.workspaceId > String(args.p_after))
        .slice(0, 2);
    },
  });
  const result = await store.summary();
  assert.equal(result.status, "descriptive");
  assert.equal(result.cohorts.length, 1);
  assert.equal(result.cohorts[0].group, "family");
  assert.equal(configReads, 2);
  assert.equal(names.at(-1), "grader_outcome_research_current_consent");
  assert.equal(
    names.filter((n) => n === "grader_outcome_research_source_page").length,
    16,
  );
  const serialized = JSON.stringify(result);
  for (const prohibited of [
    uuid(1),
    "PRIVATE",
    key(uuid(1)),
    "workspaceId",
    "workspaceKey",
    "contentHash",
    'periods":',
    "practiceArea",
  ])
    assert.equal(serialized.includes(prohibited), false, prohibited);
});
test("permission withdrawal during read removes contribution before any threshold is evaluated", async () => {
  const rows = data();
  const store = createPracticeBenchmarkStore({
    activeConfig: async () => active(),
    counts: async () => ({ benchmarkingConsent: 30 }),
    pseudonym: key,
    now: () => now,
    rpc: async (name, args = {}) =>
      name === "grader_outcome_research_current_consent"
        ? rows.slice(1).map((r) => r.workspaceId)
        : rows
            .filter(
              (r) => !args.p_after || r.workspaceId > String(args.p_after),
            )
            .slice(0, 2),
  });
  assert.deepEqual((await store.summary()).cohorts, []);
});
test("bounded full pages fail closed even after 30 eligible rows; no partial or convenience sample publishes", async () => {
  let pages = 0,
    projected = 0;
  const store = createPracticeBenchmarkStore({
    activeConfig: async () => active(),
    counts: async () => ({ benchmarkingConsent: 1000 }),
    pseudonym: (id) => {
      projected++;
      return key(id);
    },
    now: () => now,
    rpc: async (name) => {
      assert.equal(name, "grader_outcome_research_source_page");
      const n = pages++ * 2;
      return [source(n + 1), source(n + 2)];
    },
  });
  const result = await store.summary();
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.cohorts, []);
  assert.equal(pages, 100);
  assert.equal(projected, 0);
});
test("malformed pages, duplicate cursors, unexpected permissions and consent rechecks cannot publish", async () => {
  for (const kind of [
    "oversized",
    "duplicate",
    "permission",
    "consent-duplicate",
    "consent-foreign",
    "provider-error",
  ]) {
    const rows = data();
    let calls = 0;
    const store = createPracticeBenchmarkStore({
      activeConfig: async () => active(),
      counts: async () => ({ benchmarkingConsent: 30 }),
      pseudonym: key,
      now: () => now,
      rpc: async (name, args = {}) => {
        if (name === "grader_outcome_research_current_consent")
          return kind === "consent-duplicate"
            ? [uuid(1), uuid(1)]
            : [uuid(9999)];
        if (kind === "provider-error")
          return {
            error: "source_unavailable",
            privateValue: "MUST NOT ESCAPE",
          };
        if (kind === "oversized") return rows.slice(0, 3);
        if (kind === "duplicate") return [rows[0], rows[0]];
        if (kind === "permission") {
          rows[0].outcomeResearch = false;
          return rows.slice(0, 1);
        }
        if (calls++ === 0) return rows.slice(0, 1);
        return [];
      },
    });
    await assert.rejects(store.summary(), PracticeBenchmarksUnavailable, kind);
  }
});
test("active config must be approved, canonical and unchanged, while future practice mappings await deliberate review", async () => {
  for (const kind of [
    "hash",
    "release-change",
    "content-change",
    "unapproved",
  ]) {
    let reads = 0;
    const store = createPracticeBenchmarkStore({
      activeConfig: async () => {
        const value = active();
        if (kind === "hash") value.contentHash = "a".repeat(64);
        if (kind === "unapproved") {
          Object.assign(value.release, { status: "draft" });
          value.contentHash = configurationHash(value.release);
        }
        if (reads++ > 0) {
          if (kind === "release-change") value.release.id = "later-r2";
          else value.release.label = "changed same ID";
          value.contentHash = configurationHash(value.release);
        }
        return value;
      },
      counts: async () => ({ benchmarkingConsent: 30 }),
      pseudonym: key,
      now: () => now,
      rpc: async () => [],
    });
    await assert.rejects(store.summary(), PracticeBenchmarksUnavailable, kind);
  }
  let reads = 0;
  const next = active();
  next.release.id = "review-needed-r2";
  next.contentHash = configurationHash(next.release);
  const store = createPracticeBenchmarkStore({
    activeConfig: async () => next,
    counts: async () => {
      reads++;
      return { benchmarkingConsent: 999 };
    },
    pseudonym: key,
    now: () => now,
    rpc: async () => {
      throw new Error("Unexpected source read");
    },
  });
  const result = await store.summary();
  assert.equal(result.mappingSupported, false);
  assert.equal(result.publicationEnabled, false);
  assert.equal(reads, 0);
});
test("public route rejects every query-time slice before any provider access", async () => {
  for (const query of [
    "?area=family",
    "?currency=USD",
    "?workspaceId=" + uuid(1),
    "?page=1",
  ]) {
    const response = await GET(
      new Request("https://grader.example/api/practice-benchmarks" + query),
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal((await response.json()).code, "filters_unavailable");
  }
});
