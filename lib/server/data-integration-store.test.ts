import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDataIntegrationStore } from "./data-integration-store";
import {
  CREATE_DATA_CONNECTION_CONFIRMATION,
  DataIntegrationError,
  dataIntegrationBearer,
  decodeDataDelivery,
  parseDataDeliveryInput,
} from "../data-integrations";
import { POST as ingress } from "../../app/api/integrations/outcomes/route";
import { POST as createConnection } from "../../app/api/account/data-connections/route";
import { POST as acceptDelivery } from "../../app/api/account/data-deliveries/[id]/import/route";
const owner = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  connectionId = "33333333-3333-4333-8333-333333333333",
  batchId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-10-19T12:00:00Z");
const period = {
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  source: "export",
  currency: "USD",
  baselineReportId: null,
  inquiries: 20,
  contacted: null,
  booked: null,
  attended: null,
  clients: 2,
  leadSpendMinor: 12345,
  cohortBilledMinor: 100000,
  cohortCollectedMinor: null,
  adminHours: 30,
};
const body = { requestId: id, periods: [period] };
const c = {
  id: connectionId,
  revision: 0,
  createdAt: now.toISOString(),
  expiresAt: "2026-11-18T12:00:00Z",
  revokedAt: null,
  lastReceivedAt: null,
  hint: "ABcd",
};
const summary = {
  id,
  connectionId,
  revision: 0,
  createdAt: now.toISOString(),
  expiresAt: "2026-10-26T12:00:00Z",
  status: "pending",
  periodCount: 1,
  importBatchId: null,
};
test("delivery validation accepts normalized aggregate totals but rejects identity, scopes, overlap and coercion", () => {
  assert.deepEqual(parseDataDeliveryInput(body, now).periods, [period]);
  for (const value of [
    { ...body, ownerId: owner },
    { ...body, periods: [{ ...period, client_name: "PRIVATE" }] },
    { ...body, periods: [{ ...period, source: "self_reported" }] },
    { ...body, periods: [{ ...period, baselineReportId: owner }] },
    { ...body, periods: [{ ...period, clients: "2" }] },
    { ...body, periods: [period, period] },
  ])
    assert.throws(
      () => parseDataDeliveryInput(value, now),
      (e: unknown) =>
        e instanceof DataIntegrationError && !e.message.includes("PRIVATE"),
    );
});
test("connection secret is random256bit format; RPC receives only digest and bounded hint derived for verified owner", async () => {
  const calls: unknown[] = [];
  const store = createDataIntegrationStore({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return c;
    },
    bytes: () => Buffer.alloc(32, 7),
  });
  const result = await store.create(owner, {
    confirm: CREATE_DATA_CONNECTION_CONFIRMATION,
  });
  assert.match(result.token, /^plg_in_[A-Za-z0-9_-]{43}$/);
  assert.equal(dataIntegrationBearer("Bearer " + result.token), result.token);
  const call = calls[0] as { args: Record<string, unknown> };
  assert.equal(call.args.p_user_id, owner);
  assert.equal(
    call.args.p_hash,
    createHash("sha256").update(result.token).digest("hex"),
  );
  assert.equal(JSON.stringify(calls).includes(result.token), false);
  await assert.rejects(() =>
    store.create(owner, {
      confirm: CREATE_DATA_CONNECTION_CONFIRMATION,
      token: "PRIVATE",
    }),
  );
  assert.equal(calls.length, 1);
});
test("untrusted bodies and missing credentials never reach service persistence", async () => {
  let calls = 0;
  const store = createDataIntegrationStore({
    rpc: async () => {
      calls++;
      return null;
    },
    now: () => now,
  });
  for (const bearer of [
    null,
    "Bearer wrong",
    "Basic fake",
    "Bearer plg_in_" + "a".repeat(44),
  ])
    await assert.rejects(() => store.receive(bearer, body));
  await assert.rejects(() =>
    store.receive("Bearer plg_in_" + "a".repeat(43), {
      ...body,
      ownerUserId: owner,
    }),
  );
  assert.equal(calls, 0);
});
test("ingress hashes canonical sorted rows and never passes a caller-selected owner or raw credential", async () => {
  const calls: Record<string, unknown>[] = [];
  const store = createDataIntegrationStore({
    rpc: async (_name, args = {}) => {
      calls.push(args);
      return {
        deliveryId: id,
        status: "pending",
        periodCount: 1,
        duplicate: false,
      };
    },
    now: () => now,
  });
  const received = await store.receive("Bearer plg_in_" + "a".repeat(43), body);
  assert.equal(received.duplicate, false);
  assert.equal(calls[0].p_user_id, undefined);
  assert.equal(calls[0].p_token, undefined);
  assert.match(String(calls[0].p_token_hash), /^[a-f0-9]{64}$/);
  assert.deepEqual(calls[0].p_periods, [period]);
  assert.equal(JSON.stringify(calls).includes("plg_in_"), false);
});
test("acceptance needs explicit review and exact current revision; saved receipt must match imported delivery", async () => {
  let calls = 0;
  const store = createDataIntegrationStore({
    rpc: async () => {
      calls++;
      return {
        delivery: {
          ...summary,
          status: "imported",
          revision: 1,
          importBatchId: batchId,
          periods: null,
        },
        result: {
          batchId,
          periodIds: [owner],
          created: true,
          replayed: false,
          activePeriodCount: 1,
        },
      };
    },
  });
  await assert.rejects(() => store.accept(owner, id, { revision: 0 }));
  assert.equal(calls, 0);
  const result = await store.accept(owner, id, {
    revision: 0,
    confirm: "IMPORT REVIEWED TOTALS",
  });
  assert.equal(result.delivery.periods, null);
  assert.equal(result.result.created, true);
  const corrupt = createDataIntegrationStore({
    rpc: async () => ({
      delivery: {
        ...summary,
        status: "imported",
        importBatchId: owner,
        periods: null,
      },
      result: {
        batchId,
        periodIds: [owner],
        created: true,
        replayed: false,
        activePeriodCount: 1,
      },
    }),
  });
  await assert.rejects(() =>
    corrupt.accept(owner, id, {
      revision: 0,
      confirm: "IMPORT REVIEWED TOTALS",
    }),
  );
});
test("terminal receipts cannot restore staged values and private exports retain only canonical pending values", async () => {
  for (const status of ["discarded", "expired", "imported"]) {
    assert.throws(() =>
      decodeDataDelivery({
        ...summary,
        status,
        importBatchId: status === "imported" ? batchId : null,
        periods: [period],
      }),
    );
  }
  const store = createDataIntegrationStore({
    rpc: async () => ({
      connections: [{ ...c, token_hash: "PRIVATE", token: "PRIVATE" }],
      deliveries: [
        {
          ...summary,
          periods: [period],
          content_hash: "PRIVATE",
          raw: "PRIVATE",
        },
      ],
    }),
  });
  const result = await store.exportOwn(owner);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.equal("hint" in result.connections[0], false);
  assert.equal(result.deliveries[0].periods?.[0].inquiries, 20);
});
test("revocation, rejection and CAS errors expose fixed codes without backend contents", async () => {
  for (const code of [
    "invalid_connection_key",
    "data_revision_conflict",
    "data_delivery_conflict",
    "data_delivery_limit",
  ]) {
    const store = createDataIntegrationStore({
      rpc: async () => ({ error: code, raw: "PRIVATE" }),
      now: () => now,
    });
    await assert.rejects(
      () => store.receive("Bearer plg_in_" + "a".repeat(43), body),
      (e: unknown) =>
        e instanceof DataIntegrationError &&
        e.code === code &&
        !e.message.includes("PRIVATE"),
    );
  }
  const unavailable = createDataIntegrationStore({
    rpc: async () => {
      throw new Error("PRIVATE credentials");
    },
    now: () => now,
  });
  await assert.rejects(
    () => unavailable.receive("Bearer plg_in_" + "a".repeat(43), body),
    (e: unknown) =>
      e instanceof DataIntegrationError &&
      e.status === 503 &&
      !e.message.includes("PRIVATE"),
  );
});
test("all owner mutations reject cross-origin before account or storage; token ingress rejects browser requests and missing keys", async () => {
  const make = (path: string, origin?: string) =>
    new Request("https://grader.example" + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: "{}",
    });
  assert.equal(
    (
      await createConnection(
        make("/api/account/data-connections", "https://other.example"),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await acceptDelivery(
        make(
          "/api/account/data-deliveries/" + id + "/import",
          "https://other.example",
        ),
        { params: Promise.resolve({ id }) },
      )
    ).status,
    403,
  );
  const browser = await ingress(
    make("/api/integrations/outcomes", "https://grader.example"),
  );
  assert.equal(browser.status, 403);
  assert.equal(browser.headers.get("access-control-allow-origin"), null);
  const missing = await ingress(make("/api/integrations/outcomes"));
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get("cache-control") || "", /no-store/);
});
