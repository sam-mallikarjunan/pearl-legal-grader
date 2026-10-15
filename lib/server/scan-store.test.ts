import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createScanStore,
  ScanConfigError,
  ScanDatabaseError,
  ScanLimitError,
  type ReserveScanInput,
} from "./scan-store";
import type { WebsiteScanResult } from "../website/types";

const id = "11111111-1111-4111-8111-111111111111";
const secret = "sb_secret_" + "s".repeat(40);
const input = (): ReserveScanInput => ({
  id,
  url: "https://firm.example/",
  urlHash: "a".repeat(64),
  tokenHash: "b".repeat(64),
  clientHash: "c".repeat(64),
  scannerVersion: "website-scan-v1",
  rubricVersion: "website-rubric-v1",
  force: false,
});
const job = () => ({
  scanId: id,
  status: "queued",
  stage: "queued",
  createdAt: "2026-10-15T18:00:00.000Z",
  updatedAt: "2026-10-15T18:00:00.000Z",
  expiresAt: "2026-11-14T18:00:00.000Z",
});
const result = (): WebsiteScanResult => ({
  scannerVersion: "website-scan-v1",
  rubricVersion: "website-rubric-v1",
  status: "unavailable",
  submittedUrl: "https://firm.example/",
  finalUrl: null,
  startedAt: "2026-10-15T18:00:00.000Z",
  completedAt: "2026-10-15T18:00:01.000Z",
  durationMs: 1000,
  pages: [],
  findings: [],
  score: null,
  coverage: 0,
  measuredChecks: 0,
  totalChecks: 20,
  suggestedContext: {
    firmName: null,
    practiceAreas: [],
    locations: [],
    evidence: [],
    requiresConfirmation: true,
  },
  technologies: [],
  performance: {
    status: "unavailable",
    strategy: "mobile",
    fetchedAt: "2026-10-15T18:00:01.000Z",
    sourceUrl: "https://firm.example/",
    reason: "Audit unavailable",
    categories: {},
    metrics: [],
    opportunities: [],
  },
  warnings: ["Website unavailable"],
  limitations: ["Public pages only"],
});
function mockStore(response: unknown, status = 200, key = secret) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(response), {
          status,
          headers: { "content-type": "application/json" },
        });
  };
  return {
    calls,
    store: createScanStore({
      url: "https://unit.supabase.co/",
      key,
      fetch: fetcher,
    }),
  };
}

test("modern secrets use only the apikey header and reservation sends hashes, not raw capabilities or IPs", async () => {
  const { store, calls } = mockStore({ ...job(), cached: false, start: true });
  const reservation = await store.reserveScan(input());
  assert.equal(reservation.start, true);
  assert.equal(
    calls[0].url,
    "https://unit.supabase.co/rest/v1/rpc/reserve_website_scan",
  );
  const headers = calls[0].init!.headers as Record<string, string>;
  assert.equal(headers.apikey, secret);
  assert.equal(headers.Authorization, undefined);
  assert.equal(calls[0].init!.cache, "no-store");
  assert.equal(calls[0].init!.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].init!.body as string), {
    p_id: id,
    p_url: input().url,
    p_url_hash: input().urlHash,
    p_token_hash: input().tokenHash,
    p_client_hash: input().clientHash,
    p_scanner_version: input().scannerVersion,
    p_rubric_version: input().rubricVersion,
    p_force: false,
  });
});

test("legacy service role JWT compatibility sends both headers; anon and publishable keys are refused", async () => {
  const jwt = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  const { store, calls } = mockStore(null, 200, jwt);
  await store.purgeExpiredScans();
  assert.equal(
    (calls[0].init!.headers as Record<string, string>).Authorization,
    `Bearer ${jwt}`,
  );
  for (const key of [
    "",
    "sb_publishable_" + "a".repeat(40),
    `header.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`,
    "not-a-secret",
  ])
    assert.throws(
      () => createScanStore({ url: "https://unit.supabase.co", key }),
      ScanConfigError,
    );
});

test("configuration rejects an unrelated host, credentials, paths, and query-bearing provider URLs", () => {
  for (const url of [
    "https://attacker.invalid",
    "https://unit.supabase.co.evil.invalid",
    "http://unit.supabase.co",
    "https://user:password@unit.supabase.co",
    "https://unit.supabase.co/rest/v1",
    "https://unit.supabase.co?token=secret",
  ])
    assert.throws(() => createScanStore({ url, key: secret }), ScanConfigError);
});

test("only known database limit tags become client-facing rate limits with bounded retry times", async () => {
  for (const code of [
    "client_limit",
    "global_limit",
    "domain_cooldown",
  ] as const) {
    const { store } = mockStore(
      { code: "P0001", message: code, details: "123" },
      400,
    );
    await assert.rejects(
      store.reserveScan(input()),
      (error) =>
        error instanceof ScanLimitError &&
        error.code === code &&
        error.status === 429 &&
        error.retryAfterSeconds === 123,
    );
  }
  const { store } = mockStore(
    { code: "P0001", message: "global_limit", details: "9999999999" },
    400,
  );
  await assert.rejects(
    store.reserveScan(input()),
    (error) =>
      error instanceof ScanLimitError && error.retryAfterSeconds === 31 * 86400,
  );
});

test("provider and transport errors never expose their text or secret-bearing causes", async () => {
  const marker = "raw-provider-error " + secret;
  for (const code of ["P0001", "42501", "XX000"]) {
    const { store } = mockStore(
      { code, message: marker, details: marker },
      500,
    );
    await assert.rejects(
      store.readScan(id, input().tokenHash),
      (error) =>
        error instanceof ScanDatabaseError &&
        !String(error).includes(marker) &&
        !Object.prototype.hasOwnProperty.call(error, "cause"),
    );
  }
  const store = createScanStore({
    url: "https://unit.supabase.co",
    key: secret,
    fetch: async () => {
      throw new Error(marker);
    },
  });
  await assert.rejects(
    store.purgeExpiredScans(),
    (error) =>
      error instanceof ScanDatabaseError && !String(error).includes(secret),
  );
});

test("read requires the capability hash and treats unauthorized or expired database results as missing", async () => {
  const { store, calls } = mockStore(null);
  assert.equal(await store.readScan(id, "not-a-token-hash"), null);
  assert.equal(calls.length, 0);
  assert.equal(await store.readScan(id, input().tokenHash), null);
  assert.deepEqual(JSON.parse(calls[0].init!.body as string), {
    p_id: id,
    p_token_hash: input().tokenHash,
  });
});

test("stored result snapshots preserve meaningful nulls and malformed job shapes are rejected", async () => {
  const snapshot = { ...job(), status: "unavailable", result: result() };
  assert.deepEqual(
    await mockStore(snapshot).store.readScan(id, input().tokenHash),
    snapshot,
  );
  for (const bad of [
    { ...job(), status: "complete" },
    { ...job(), expiresAt: "yesterday" },
    { ...snapshot, result: { ...result(), score: -1 } },
    { ...job(), status: "published" },
    { ...job(), scanId: "different-id" },
  ])
    await assert.rejects(
      mockStore(bad).store.readScan(id, input().tokenHash),
      ScanDatabaseError,
    );
});

test("claim responses support lost-lease no-ops and reject unsafe returned addresses", async () => {
  assert.equal(await mockStore(null).store.claimScan(id, "lease-one"), null);
  assert.deepEqual(
    await mockStore({ url: "https://firm.example/" }).store.claimScan(
      id,
      "lease-one",
    ),
    { url: "https://firm.example/" },
  );
  await assert.rejects(
    mockStore({ url: "https://user:secret@firm.example/" }).store.claimScan(
      id,
      "lease-one",
    ),
    ScanDatabaseError,
  );
});

test("workflow mutations address the lease and submit the exact validated result", async () => {
  const { store, calls } = mockStore(null, 204);
  await store.updateScanProgress(id, "lease-one", "performance");
  await store.completeScan(id, "lease-one", result());
  await store.failScan(
    id,
    "lease-one",
    "A bounded public website check failed.",
  );
  await store.recordWorkflowRun(id, "workflow-one");
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname.split("/").at(-1)),
    [
      "update_website_scan_progress",
      "complete_website_scan",
      "fail_website_scan",
      "record_website_scan_workflow",
    ],
  );
  assert.deepEqual(JSON.parse(calls[1].init!.body as string), {
    p_id: id,
    p_lease_id: "lease-one",
    p_result: result(),
  });
  await assert.rejects(
    store.completeScan(id, "lease-one", { ...result(), coverage: 101 }),
    ScanDatabaseError,
  );
  await assert.rejects(
    store.updateScanProgress(id, "", "performance"),
    ScanDatabaseError,
  );
  assert.equal(calls.length, 4);
});

test("invalid reservations and unreadable database responses fail before producing a report", async () => {
  const { store, calls } = mockStore({ ...job(), cached: false, start: true });
  await assert.rejects(
    store.reserveScan({ ...input(), clientHash: "raw-ip" }),
    ScanDatabaseError,
  );
  assert.equal(calls.length, 0);
  await assert.rejects(
    mockStore({ ...job(), cached: "true", start: true }).store.reserveScan(
      input(),
    ),
    ScanDatabaseError,
  );
  const unreadable = createScanStore({
    url: "https://unit.supabase.co",
    key: secret,
    fetch: async () =>
      new Response("<html>Provider unavailable</html>", { status: 502 }),
  });
  await assert.rejects(unreadable.purgeExpiredScans(), ScanDatabaseError);
});
