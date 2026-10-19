import { createHash, randomBytes } from "node:crypto";
import {
  accountRecord,
  accountUuid,
  canonicalJson,
} from "../account/validation";
import {
  DATA_INTEGRATION_LIMITS,
  DataIntegrationError,
  dataIntegrationBearer,
  decodeDataConnection,
  decodeDataDelivery,
  decodeDataDeliverySummary,
  parseCreateDataConnection,
  parseDataDeliveryInput,
  parseDataIntegrationRevision,
} from "../data-integrations";
import { decodeOutcomeImportResult } from "../outcome-batch-import";
import { accountRpc } from "./account-db";

if (typeof window !== "undefined")
  throw new Error("Connection credentials run on the server.");
const fail = () =>
  new DataIntegrationError(
    "data_integration_unavailable",
    "Your private data connection is temporarily unavailable. Refresh before trying again.",
    503,
  );
const errors: Record<string, [number, string]> = {
  invalid_connection_key: [
    401,
    "The aggregate connection key is missing, expired or revoked.",
  ],
  data_connection_limit: [
    429,
    "This account has reached its connection allowance. Revoke an active key if the active-key limit is full; revocation does not reset retained history.",
  ],
  data_delivery_limit: [
    429,
    "The delivery allowance is full. Review or discard pending deliveries, or wait for the daily allowance to renew.",
  ],
  data_delivery_conflict: [
    409,
    "This request ID already contains different totals. Send corrected totals with a new request ID.",
  ],
  data_revision_conflict: [
    409,
    "This saved item changed. Refresh and review its current revision before trying again.",
  ],
  data_delivery_closed: [
    410,
    "This delivery was discarded or expired. Send a new delivery if you still need these totals.",
  ],
  data_not_found: [
    404,
    "This connection or delivery is unavailable in your workspace.",
  ],
  invalid_data_delivery: [
    400,
    "Only closed aggregate totals using the documented fields are accepted.",
  ],
  outcome_period_overlap: [
    409,
    "A period overlaps saved data. Nothing was imported; the delivery is still pending.",
  ],
  outcome_plan_overlap: [
    409,
    "A period belongs to a registered plan. Use that plan to report it; nothing was imported.",
  ],
  outcome_period_limit: [
    429,
    "This import would exceed 24 saved periods. Nothing was imported.",
  ],
  outcome_import_limit: [
    429,
    "The retained import allowance is full. Existing export and deletion remain available.",
  ],
  outcome_import_request_conflict: [
    409,
    "The saved import request changed. Refresh your periods before trying again.",
  ],
  outcome_change_limit: [
    429,
    "The change allowance is full. Nothing was imported.",
  ],
  invalid_outcome: [
    400,
    "One aggregate period is invalid. Nothing was imported.",
  ],
};
function owner(id: string) {
  if (!accountUuid(id))
    throw new DataIntegrationError(
      "invalid_account",
      "Sign in to your own workspace.",
      401,
    );
}
function identifier(id: string) {
  if (!accountUuid(id))
    throw new DataIntegrationError(
      "data_not_found",
      "This item is unavailable in your workspace.",
      404,
    );
}
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
export function createDataIntegrationStore(d: {
  rpc: typeof accountRpc;
  bytes?: () => Buffer;
  now?: () => Date;
}) {
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    try {
      const v = await d.rpc(name, args);
      if (accountRecord(v) && typeof v.error === "string") {
        const e = errors[v.error];
        if (e) throw new DataIntegrationError(v.error, e[1], e[0]);
        throw fail();
      }
      return v;
    } catch (e) {
      if (e instanceof DataIntegrationError) throw e;
      if (accountRecord(e) && typeof e.code === "string" && errors[e.code]) {
        const x = errors[e.code];
        throw new DataIntegrationError(e.code, x[1], x[0]);
      }
      throw fail();
    }
  };
  return {
    async connections(userId: string) {
      owner(userId);
      const v = await rpc("grader_read_data_connections", {
        p_user_id: userId,
      });
      if (
        !Array.isArray(v) ||
        v.length > DATA_INTEGRATION_LIMITS.retainedConnections
      )
        throw fail();
      const values = v.map(decodeDataConnection);
      if (new Set(values.map((x) => x.id)).size !== values.length) throw fail();
      return values;
    },
    async create(userId: string, body: unknown) {
      owner(userId);
      parseCreateDataConnection(body);
      const b = d.bytes?.() ?? randomBytes(32);
      if (b.length !== 32) throw fail();
      const token = "plg_in_" + b.toString("base64url");
      const connection = decodeDataConnection(
        await rpc("grader_create_data_connection", {
          p_user_id: userId,
          p_hash: sha(token),
          p_hint: token.slice(-4),
        }),
      );
      return { connection, token };
    },
    async revoke(userId: string, id: string, body: unknown) {
      owner(userId);
      identifier(id);
      const revision = parseDataIntegrationRevision(body);
      return decodeDataConnection(
        await rpc("grader_revoke_data_connection", {
          p_user_id: userId,
          p_id: id,
          p_revision: revision,
        }),
      );
    },
    async receive(bearer: string | null, body: unknown) {
      const token = dataIntegrationBearer(bearer);
      const parsed = parseDataDeliveryInput(body, d.now?.());
      const v = await rpc("grader_receive_data_delivery", {
        p_token_hash: sha(token),
        p_request: parsed.requestId,
        p_hash: sha(canonicalJson(parsed.periods)),
        p_periods: parsed.periods,
      });
      if (
        !accountRecord(v) ||
        !accountUuid(v.deliveryId) ||
        !["pending", "imported", "discarded", "expired"].includes(
          String(v.status),
        ) ||
        !Number.isInteger(v.periodCount) ||
        Number(v.periodCount) < 1 ||
        Number(v.periodCount) > 24 ||
        typeof v.duplicate !== "boolean"
      )
        throw fail();
      return {
        deliveryId: v.deliveryId,
        status: v.status,
        periodCount: Number(v.periodCount),
        duplicate: v.duplicate,
      };
    },
    async deliveries(userId: string) {
      owner(userId);
      const v = await rpc("grader_read_data_deliveries", { p_user_id: userId });
      if (
        !Array.isArray(v) ||
        v.length > DATA_INTEGRATION_LIMITS.retainedDeliveries
      )
        throw fail();
      const rows = v.map(decodeDataDeliverySummary);
      if (new Set(rows.map((x) => x.id)).size !== rows.length) throw fail();
      return rows;
    },
    async delivery(userId: string, id: string) {
      owner(userId);
      identifier(id);
      return decodeDataDelivery(
        await rpc("grader_read_data_delivery", { p_user_id: userId, p_id: id }),
      );
    },
    async accept(userId: string, id: string, body: unknown) {
      owner(userId);
      identifier(id);
      const revision = parseDataIntegrationRevision(body, true);
      const v = await rpc("grader_accept_data_delivery", {
        p_user_id: userId,
        p_id: id,
        p_revision: revision,
      });
      if (!accountRecord(v)) throw fail();
      const delivery = decodeDataDelivery(v.delivery),
        result = decodeOutcomeImportResult(v.result);
      if (
        delivery.status !== "imported" ||
        delivery.importBatchId !== result.batchId ||
        delivery.periodCount !== result.periodIds.length
      )
        throw fail();
      return { delivery, result };
    },
    async discard(userId: string, id: string, body: unknown) {
      owner(userId);
      identifier(id);
      const revision = parseDataIntegrationRevision(body);
      return decodeDataDelivery(
        await rpc("grader_discard_data_delivery", {
          p_user_id: userId,
          p_id: id,
          p_revision: revision,
        }),
      );
    },
    async exportOwn(userId: string) {
      owner(userId);
      const v = await rpc("grader_export_data_integrations", {
        p_user_id: userId,
      });
      if (
        !accountRecord(v) ||
        !Array.isArray(v.connections) ||
        v.connections.length > 24 ||
        !Array.isArray(v.deliveries) ||
        v.deliveries.length > 100
      )
        throw fail();
      const connections = v.connections
          .map(decodeDataConnection)
          .map(({ hint, ...safe }) => {
            void hint;
            return safe;
          }),
        deliveries = v.deliveries.map(decodeDataDelivery);
      if (
        new Set(connections.map((x) => x.id)).size !== connections.length ||
        new Set(deliveries.map((x) => x.id)).size !== deliveries.length
      )
        throw fail();
      return { connections, deliveries, limits: DATA_INTEGRATION_LIMITS };
    },
    async cleanup() {
      const v = await rpc("grader_expire_data_deliveries");
      if (
        !accountRecord(v) ||
        !Number.isInteger(v.expired) ||
        Number(v.expired) < 0
      )
        throw fail();
      return { expired: Number(v.expired) };
    },
  };
}
export const dataIntegrationStore = () =>
  createDataIntegrationStore({ rpc: accountRpc });
export const exportOwnDataIntegrations = (userId: string) =>
  dataIntegrationStore().exportOwn(userId);
