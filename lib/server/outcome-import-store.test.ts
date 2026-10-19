import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createOutcomeImportStore,
  OutcomeImportStorageError,
} from "./outcome-import-store";
import {
  parseOutcomeImportInput,
  decodeOutcomeImportResult,
} from "../outcome-batch-import";
import { POST } from "../../app/api/account/outcomes/import/route";
const user = "9780410c-1dc0-4b82-a272-b4e3add6a081";
const requestId = "72deca47-3878-4ce7-acce-fd5e8949589f";
const batchId = "4f03b79c-908b-47bc-ad81-873c82efb0ae";
const periodIds = [
  "5297ad82-c04a-40c2-92d9-9e4bbf4306e9",
  "80241c28-3312-4b20-bb6d-e3bb52b508e7",
];
const now = new Date("2026-10-19T16:00:00Z");
const row = {
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  source: "export",
  currency: "USD",
  baselineReportId: null,
  inquiries: 20,
  clients: 3,
  adminHours: 12.5,
  cohortBilledMinor: 100010,
  cohortCollectedMinor: null,
};
const earlier = { ...row, startDate: "2026-08-01", endDate: "2026-08-31" };
const body = {
  requestId,
  periods: [row, earlier],
  confirm: "IMPORT REVIEWED TOTALS",
};
const result = {
  batchId,
  periodIds,
  created: true,
  replayed: false,
  activePeriodCount: 2,
};

test("reviewed imports normalize and sort aggregates, preserving minor money and unknown fields", () => {
  const parsed = parseOutcomeImportInput(body, now);
  assert.equal(parsed.periods[0].startDate, "2026-08-01");
  assert.equal(parsed.periods[1].cohortBilledMinor, 100010);
  assert.equal(parsed.periods[1].cohortCollectedMinor, null);
  assert.equal(parsed.periods[1].contacted, null);
  assert.equal(row.startDate, "2026-09-01");
});
test("files, mappings, identities, missing confirmation and unbounded batches never reach storage", async () => {
  let writes = 0;
  const store = createOutcomeImportStore({
    now: () => now,
    rpc: async () => {
      writes++;
      return result;
    },
  });
  for (const bad of [
    { ...body, csv: "PRIVATE-SENTINEL" },
    { ...body, ownerUserId: user },
    { ...body, confirm: "yes" },
    { ...body, periods: [] },
    { ...body, periods: Array(25).fill(row) },
    { ...body, periods: [{ ...row, client_name: "PRIVATE-SENTINEL" }] },
    { ...body, periods: [{ ...row, source: "self_reported" }] },
    { ...body, periods: [{ ...row, baselineReportId: batchId }] },
    { ...body, periods: [{ ...row, clients: 21 }] },
    { ...body, periods: [{ ...row, cohortCollectedMinor: 100011 }] },
    { ...body, periods: [{ ...row, endDate: "2026-10-19" }] },
  ]) {
    await assert.rejects(
      store.importRows(user, bad),
      (e) => e instanceof Error && !e.message.includes("PRIVATE-SENTINEL"),
    );
  }
  assert.equal(writes, 0);
});
test("duplicate or overlapping input rows reject the whole reviewed batch", () => {
  for (const periods of [
    [row, row],
    [row, { ...row, startDate: "2026-09-15", endDate: "2026-10-01" }],
  ])
    assert.throws(
      () => parseOutcomeImportInput({ ...body, periods }, now),
      (e: any) => e.code === "outcome_import_overlap" && e.status === 409,
    );
});
test("ownership and idempotency hash derive on server; input order cannot change the hash", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const store = createOutcomeImportStore({
    now: () => now,
    rpc: async (name, args = {}) => {
      calls.push({ name, args });
      return result;
    },
  });
  assert.deepEqual(await store.importRows(user, body), result);
  await store.importRows(user, { ...body, periods: [earlier, row] });
  assert.equal(calls[0].name, "grader_import_outcome_periods");
  assert.equal(calls[0].args.p_user_id, user);
  assert.equal(calls[0].args.p_request, requestId);
  assert.match(String(calls[0].args.p_hash), /^[a-f0-9]{64}$/);
  assert.equal(calls[0].args.p_hash, calls[1].args.p_hash);
  assert.equal("csv" in calls[0].args, false);
  await assert.rejects(store.importRows("forged", body));
  assert.equal(calls.length, 2);
});
test("exact retry reports deleted periods as absent without claiming a new import", async () => {
  const replay = {
    ...result,
    created: false,
    replayed: true,
    activePeriodCount: 1,
  };
  const store = createOutcomeImportStore({
    now: () => now,
    rpc: async () => replay,
  });
  assert.deepEqual(await store.importRows(user, body), replay);
  assert.deepEqual(
    decodeOutcomeImportResult({ ...replay, activePeriodCount: 0 }),
    { ...replay, activePeriodCount: 0 },
  );
});
test("conflicts, limits and planned-period reservations return actionable errors without leaking database messages", async () => {
  for (const [code, status] of [
    ["outcome_import_request_conflict", 409],
    ["outcome_period_overlap", 409],
    ["outcome_plan_overlap", 409],
    ["outcome_period_limit", 429],
    ["outcome_import_limit", 429],
  ]) {
    const store = createOutcomeImportStore({
      now: () => now,
      rpc: async () => ({ error: code }),
    });
    await assert.rejects(
      store.importRows(user, body),
      (e: any) =>
        e.code === code &&
        e.status === status &&
        e.message.includes("PRIVATE-SENTINEL") === false,
    );
  }
  const failed = createOutcomeImportStore({
    now: () => now,
    rpc: async () => {
      throw new Error("PRIVATE-SENTINEL");
    },
  });
  await assert.rejects(
    failed.importRows(user, body),
    (e) =>
      e instanceof OutcomeImportStorageError &&
      !e.message.includes("PRIVATE-SENTINEL"),
  );
});
test("malformed or contradictory receipts cannot claim success", () => {
  for (const bad of [
    { ...result, periodIds: [periodIds[0], periodIds[0]] },
    { ...result, activePeriodCount: 1 },
    { ...result, replayed: true },
    { ...result, batchId: "invalid" },
    { ...result, created: false, replayed: true, activePeriodCount: 3 },
  ])
    assert.throws(() => decodeOutcomeImportResult(bad));
});
test("owner exports select only safe receipt fields with scope supplied by the verified user", async () => {
  let args: Record<string, unknown> = {};
  const store = createOutcomeImportStore({
    rpc: async (name, value = {}) => {
      assert.equal(name, "grader_export_outcome_imports");
      args = value;
      return {
        imports: [
          {
            batchId,
            importedAt: now.toISOString(),
            periodCount: 2,
            activePeriodCount: 1,
            content_hash: "PRIVATE-SENTINEL",
          },
        ],
      };
    },
  });
  const exported = await store.exportOwn(user);
  assert.deepEqual(args, { p_user_id: user });
  assert.equal(JSON.stringify(exported).includes("PRIVATE-SENTINEL"), false);
  assert.equal(exported.imports[0].activePeriodCount, 1);
});
test("import mutations reject cross-origin calls before authentication or request data parsing", async () => {
  const r = await POST(
    new Request("https://example.invalid/api/account/outcomes/import", {
      method: "POST",
      headers: {
        origin: "https://other.invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  assert.equal(r.status, 403);
  assert.match(r.headers.get("Cache-Control") ?? "", /no-store/);
});
