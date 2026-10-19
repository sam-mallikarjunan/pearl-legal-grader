import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  LEAD_ROUTING_CONSENT_TEXT,
  LEAD_ROUTING_CONSENT_VERSION,
} from "../lead-routing";
import { createLeadRoutingStore, LeadRoutingError } from "./lead-routing-store";
const actor = "00000000-0000-4000-8000-000000000001",
  owner = "00000000-0000-4000-8000-000000000002",
  request = "00000000-0000-4000-8000-000000000003",
  report = "00000000-0000-4000-8000-000000000004";
const source = {
  ownerUserId: owner,
  requestId: request,
  revision: 0,
  topic: "workflow",
  reportId: report,
  consentVersion: LEAD_ROUTING_CONSENT_VERSION,
  consentText: LEAD_ROUTING_CONSENT_TEXT,
};
const queue = {
  id: request,
  topic: "workflow",
  status: "open",
  revision: 0,
  createdAt: "2026-10-19T15:00:00.000Z",
  updatedAt: "2026-10-19T15:00:00.000Z",
  contactConsent: true,
  canViewContact: true,
  hasSelectedReport: true,
};
function store(
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  verifiedEmail: (_id: string) => Promise<string | null> = async () =>
    "owner@example.test",
) {
  return createLeadRoutingStore({
    rpc: (name, args = {}) => rpc(name, args),
    verifiedEmail,
    reportSummary: async (uid, rid) => {
      assert.equal(uid, owner);
      assert.equal(rid, report);
      return { score: 70, coveragePercent: 100, rubricVersion: "preview-r1" };
    },
  });
}
test("queue listing strips identity fields and never fetches verified emails automatically", async () => {
  const api = store(
    async (name) => {
      assert.equal(name, "grader_requested_contact_queue");
      return {
        requests: [
          {
            ...queue,
            verifiedEmail: "private@example.test",
            ownerUserId: owner,
          },
        ],
        truncated: false,
      };
    },
    async () => {
      throw new Error("must not fetch");
    },
  );
  const data = await api.queue();
  assert.equal(JSON.stringify(data).includes("private@example.test"), false);
  assert.equal(JSON.stringify(data).includes(owner), false);
});
test("explicit contact view derives owner, checks current verified email twice and records fresh permission before returning", async () => {
  let reads = 0;
  const calls: string[] = [];
  const api = store(
    async (name, args) => {
      calls.push(name);
      assert.equal(args.p_actor, actor);
      assert.equal(args.p_request_id, request);
      if (name === "grader_prepare_requested_contact") return source;
      assert.equal(name, "grader_record_requested_contact_view");
      assert.equal(args.p_report_id, report);
      assert.equal(reads, 2);
      return true;
    },
    async (uid) => {
      assert.equal(uid, owner);
      reads++;
      return "owner@example.test";
    },
  );
  const detail = await api.viewContact(actor, request, {
    confirm: "VIEW REQUESTED CONTACT",
    revision: 0,
  });
  assert.equal(detail.verifiedEmail, "owner@example.test");
  assert.deepEqual(detail.reportSummary, {
    score: 70,
    coveragePercent: 100,
    rubricVersion: "preview-r1",
  });
  assert.deepEqual(calls, [
    "grader_prepare_requested_contact",
    "grader_record_requested_contact_view",
  ]);
  assert.equal("ownerUserId" in detail, false);
  assert.equal("reportId" in detail, false);
});
test("old consent or missing explicit confirmation never discloses contact", async () => {
  let calls = 0;
  const api = store(async () => {
    calls++;
    return { ...source, consentVersion: "requested-pearl-help-v1" };
  });
  await assert.rejects(
    api.viewContact(actor, request, { revision: 0 }),
    (e: unknown) => e instanceof LeadRoutingError && e.status === 400,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    api.viewContact(actor, request, {
      revision: 0,
      confirm: "VIEW REQUESTED CONTACT",
    }),
  );
  assert.equal(calls, 1);
});
test("withdrawal/report-change race and changed or unverified email fail closed", async () => {
  const revoked = store(async (name) =>
    name === "grader_prepare_requested_contact" ? source : false,
  );
  await assert.rejects(
    revoked.viewContact(actor, request, {
      confirm: "VIEW REQUESTED CONTACT",
      revision: 0,
    }),
    (e: unknown) =>
      e instanceof LeadRoutingError && e.code === "contact_permission_changed",
  );
  let reads = 0;
  const changed = store(
    async () => source,
    async () => (++reads === 1 ? "owner@example.test" : "changed@example.test"),
  );
  await assert.rejects(
    changed.viewContact(actor, request, {
      confirm: "VIEW REQUESTED CONTACT",
      revision: 0,
    }),
    (e: unknown) =>
      e instanceof LeadRoutingError && e.code === "contact_email_changed",
  );
  const unverified = store(
    async () => source,
    async () => null,
  );
  await assert.rejects(
    unverified.viewContact(actor, request, {
      confirm: "VIEW REQUESTED CONTACT",
      revision: 0,
    }),
    (e: unknown) =>
      e instanceof LeadRoutingError && e.code === "contact_email_unverified",
  );
});
test("rate limits stay explicit and exports strip actor identity", async () => {
  const limited = store(async () => ({ error: "contact_view_limit" }));
  await assert.rejects(
    limited.viewContact(actor, request, {
      confirm: "VIEW REQUESTED CONTACT",
      revision: 0,
    }),
    (e: unknown) => e instanceof LeadRoutingError && e.status === 429,
  );
  const api = store(async (name, args) => {
    assert.equal(name, "grader_requested_contact_export");
    assert.equal(args.p_user_id, owner);
    return {
      contactViews: [
        {
          requestId: request,
          viewedAt: "2026-10-19T15:00:00Z",
          actorId: actor,
        },
      ],
      historyTruncated: false,
    };
  });
  const exported = await api.exportOwn(owner);
  assert.equal(JSON.stringify(exported).includes(actor), false);
  assert.equal(exported.historyTruncated, false);
});
