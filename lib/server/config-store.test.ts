import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "../catalog";
import {
  ConfigServiceError,
  configurationHash,
  getActiveConfig,
  getApprovedConfigRelease,
  getConfigHistory,
  publishConfig,
  rollbackConfig,
} from "./config-store";

const actorId = "e830c3a3-3d5d-40d8-9bfa-7e63e46b926b";
const payload = (release = structuredClone(DEFAULT_RELEASE)) => ({
  release,
  contentHash: configurationHash(release),
  publishedAt: "2026-10-16T12:00:00Z",
  reason: "A reviewed test configuration release.",
  parentId: null,
});
async function configured<T>(fn: () => Promise<T>) {
  const original = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SECRET_KEY,
    legacy: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: globalThis.fetch,
  };
  process.env.SUPABASE_URL = "https://config-test.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_synthetic_test_key";
  try {
    return await fn();
  } finally {
    for (const [key, value] of [
      ["SUPABASE_URL", original.url],
      ["SUPABASE_SECRET_KEY", original.key],
      ["SUPABASE_SERVICE_ROLE_KEY", original.legacy],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.fetch = original.fetch;
  }
}

test("configuration storage enforces reproducible releases and safe publication", async (t) => {
  await t.test(
    "unconfigured deployments expose the exact default without contacting the database",
    async () =>
      configured(async () => {
        delete process.env.SUPABASE_URL;
        globalThis.fetch = async () => {
          throw new Error("must not fetch");
        };
        const result = await getActiveConfig();
        assert.equal(result.source, "default");
        assert.deepEqual(result.release, DEFAULT_RELEASE);
      }),
  );
  await t.test(
    "configured storage failure never silently falls back",
    async () =>
      configured(async () => {
        globalThis.fetch = async () =>
          new Response("internal credential detail", { status: 500 });
        await assert.rejects(
          getActiveConfig(),
          (error: unknown) =>
            error instanceof ConfigServiceError &&
            error.status === 503 &&
            !error.message.includes("credential"),
        );
      }),
  );
  await t.test(
    "persisted content hash must match the full canonical snapshot",
    async () =>
      configured(async () => {
        globalThis.fetch = async () =>
          Response.json({ ...payload(), contentHash: "a".repeat(64) });
        await assert.rejects(getActiveConfig(), ConfigServiceError);
      }),
  );
  await t.test(
    "published release lookup accepts only stored valid history",
    async () =>
      configured(async () => {
        const release = {
          ...structuredClone(DEFAULT_RELEASE),
          id: "config-e830c3a3-3d5d-40d8-9bfa-7e63e46b926b",
        };
        globalThis.fetch = async () => Response.json(payload(release));
        assert.deepEqual(await getApprovedConfigRelease(release.id), release);
        globalThis.fetch = async () => Response.json(null);
        assert.equal(await getApprovedConfigRelease("missing-id"), null);
      }),
  );
  await t.test(
    "publish derives a new immutable ID and trusted actor, preserving input",
    async () =>
      configured(async () => {
        const release = structuredClone(DEFAULT_RELEASE);
        const prior = JSON.stringify(release);
        globalThis.fetch = async (url, init) => {
          assert.ok(String(url).endsWith("grader_config_publish"));
          const args = JSON.parse(String(init?.body));
          assert.equal(args.p_actor, actorId);
          assert.equal(args.p_expected_id, DEFAULT_RELEASE.id);
          assert.match(args.p_snapshot.id, /^config-[a-f\d-]{36}$/);
          assert.equal(args.p_hash, configurationHash(args.p_snapshot));
          return Response.json(payload(args.p_snapshot));
        };
        const result = await publishConfig({
          release,
          expectedActiveId: DEFAULT_RELEASE.id,
          reason: "Reviewed changes to wording only.",
          actorId,
        });
        assert.notEqual(result.release.id, DEFAULT_RELEASE.id);
        assert.equal(JSON.stringify(release), prior);
      }),
  );
  await t.test("concurrent publication returns a review conflict", async () =>
    configured(async () => {
      globalThis.fetch = async () => Response.json({ conflict: true });
      await assert.rejects(
        publishConfig({
          release: DEFAULT_RELEASE,
          expectedActiveId: DEFAULT_RELEASE.id,
          reason: "Reviewed question weight change.",
          actorId,
        }),
        (error: unknown) =>
          error instanceof ConfigServiceError && error.status === 409,
      );
    }),
  );
  await t.test("invalid changes cannot reach the service RPC", async () =>
    configured(async () => {
      globalThis.fetch = async () => {
        throw new Error("must not fetch");
      };
      await assert.rejects(
        publishConfig({
          release: DEFAULT_RELEASE,
          expectedActiveId: DEFAULT_RELEASE.id,
          reason: "short",
          actorId,
        }),
        (error: unknown) =>
          error instanceof ConfigServiceError && error.status === 400,
      );
      await assert.rejects(
        publishConfig({
          release: { ...DEFAULT_RELEASE, minCoverage: 0.1 },
          expectedActiveId: DEFAULT_RELEASE.id,
          reason: "Weaken coverage dangerously.",
          actorId,
        }),
        (error: unknown) =>
          error instanceof ConfigServiceError && error.status === 400,
      );
    }),
  );
  await t.test(
    "rollback requires a reason, expected current release and existing target",
    async () =>
      configured(async () => {
        globalThis.fetch = async () => Response.json({ missing: true });
        await assert.rejects(
          rollbackConfig({
            releaseId: "missing-id",
            expectedActiveId: DEFAULT_RELEASE.id,
            reason: "Restore a reviewed earlier version.",
            actorId,
          }),
          (error: unknown) =>
            error instanceof ConfigServiceError && error.status === 404,
        );
      }),
  );
  await t.test(
    "history preserves validated immutable release snapshots",
    async () =>
      configured(async () => {
        globalThis.fetch = async (url) =>
          Response.json(
            String(url).endsWith("grader_config_list_releases")
              ? [payload()]
              : payload(),
          );
        const result = await getConfigHistory();
        assert.equal(result.history.length, 1);
        assert.deepEqual(result.history[0].release, DEFAULT_RELEASE);
      }),
  );
});
