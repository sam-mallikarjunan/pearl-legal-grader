import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "../catalog";
import { HELP_CONSENT_TEXT, HELP_CONSENT_VERSION } from "../help-requests";
import { configurationHash } from "./config-store";
import { createResearchStore, ResearchServiceError } from "./research-store";
const user = "e830c3a3-3d5d-40d8-9bfa-7e63e46b926b";
const requestId = "644123fd-f604-41f0-9694-cce6218f152c";
const request = {
  id: requestId,
  topic: "intake",
  status: "open",
  createdAt: "2026-10-16T12:00:00Z",
  updatedAt: "2026-10-16T12:00:00Z",
  consentVersion: HELP_CONSENT_VERSION,
  consentText: HELP_CONSENT_TEXT,
  contactConsent: true,
  reportId: null,
  revision: 0,
};
const store = (
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  verifiedEmail: (id: string) => Promise<string | null> = async () =>
    "optin@example.com",
) =>
  createResearchStore({
    rpc: (name, args = {}) => rpc(name, args),
    activeConfig: async () => ({
      release: DEFAULT_RELEASE,
      contentHash: configurationHash(DEFAULT_RELEASE),
      publishedAt: null,
      source: "default",
      available: true,
    }),
    pseudonym: () => "pseudonym",
    verifiedEmail,
  });
test("help storage derives the user and purpose consent from trusted server state", async () => {
  const api = store(async (name, args) => {
    assert.equal(name, "grader_lead_request_routed_help");
    assert.equal(args.p_user_id, user);
    assert.equal(args.p_consent_text, HELP_CONSENT_TEXT);
    assert.equal(args.p_consent_version, HELP_CONSENT_VERSION);
    assert.equal("email" in args, false);
    return { created: true, request };
  });
  const result = await api.requestHelp(user, {
    requestId,
    topic: "intake",
    consent: true,
    consentVersion: HELP_CONSENT_VERSION,
  });
  assert.equal(result.created, true);
  assert.equal(result.request.status, "open");
});
test("missing explicit help permission never reaches database", async () => {
  const api = store(async () => {
    throw new Error("must not call");
  });
  await assert.rejects(
    api.requestHelp(user, { requestId, topic: "intake" }),
    (error: unknown) =>
      error instanceof ResearchServiceError && error.status === 400,
  );
});
test("old or absent browser consent version cannot authorize expanded queue sharing", async () => {
  const api = store(async () => {
    throw new Error("must not call");
  });
  for (const consentVersion of [undefined, "requested-pearl-help-v1"]) {
    await assert.rejects(
      api.requestHelp(user, {
        requestId,
        topic: "intake",
        consent: true,
        consentVersion,
      }),
      (error: unknown) =>
        error instanceof ResearchServiceError && error.status === 400,
    );
  }
});
test("historical v1 requests remain readable and withdrawable without upgraded permission", async () => {
  const legacy = { ...request, consentVersion: "requested-pearl-help-v1" };
  const api = store(async (name) =>
    name === "grader_lead_list_own"
      ? [legacy]
      : { ...legacy, status: "withdrawn", contactConsent: false, revision: 1 },
  );
  assert.equal(
    (await api.ownRequests(user))[0].consentVersion,
    "requested-pearl-help-v1",
  );
  assert.equal(
    (await api.withdrawRequest(user, requestId)).contactConsent,
    false,
  );
});
test("owner withdrawal and status changes use trusted identity and revision guards", async () => {
  const api = store(async (name, args) => {
    assert.equal(name, "grader_lead_withdraw");
    assert.equal(args.p_user_id, user);
    return {
      ...request,
      status: "withdrawn",
      contactConsent: false,
      revision: 1,
    };
  });
  assert.equal(
    (await api.withdrawRequest(user, requestId)).contactConsent,
    false,
  );
  const conflict = store(async () => ({ error: "revision_conflict" }));
  await assert.rejects(
    conflict.updateRequest(user, requestId, {
      status: "closed",
      revision: 0,
      reason: "The request was resolved.",
    }),
    (error: unknown) =>
      error instanceof ResearchServiceError && error.status === 409,
  );
});
test("withdrawn requested-help records cannot expose email in admin projections", async () => {
  const api = store(async () => [
    {
      ...request,
      status: "withdrawn",
      contactConsent: false,
      verifiedEmail: "private@example.com",
    },
  ]);
  assert.equal((await api.adminRequests())[0].verifiedEmail, null);
});
test("marketing and requested-help exports remain separate and omit assessments", async () => {
  const api = store(async (name, args) => {
    assert.equal(name, "grader_lead_export");
    assert.equal(args.p_purpose, "marketing");
    return [
      {
        ownerUserId: user,
        purpose: "marketing",
        topic: null,
        status: "opted_in",
        consentVersion: "account-preferences-v1",
        consentRecordedAt: "2026-10-16T12:00:00Z",
        assessment: { private: "must not export" },
      },
    ];
  });
  const csv = await api.leadCsv("marketing");
  assert.ok(csv.includes("optin@example.com"));
  assert.equal(csv.includes("assessment"), false);
  assert.equal(csv.includes("must not export"), false);
  await assert.rejects(
    api.leadCsv("all_contacts"),
    (error: unknown) =>
      error instanceof ResearchServiceError && error.status === 400,
  );
});
test("research storage rechecks current consented source without caching and records minimal export audit", async () => {
  const calls: string[] = [];
  const api = store(async (name, args) => {
    calls.push(name);
    if (name === "grader_research_source_page") return [];
    assert.equal(name, "grader_research_record_export");
    assert.equal(args.p_actor, user);
    assert.equal(args.p_rows, 0);
    assert.equal("email" in args, false);
    return true;
  });
  assert.equal((await api.dataset()).rows.length, 0);
  assert.equal((await api.dataset()).rows.length, 0);
  await api.recordExport(user, "research", 0, DEFAULT_RELEASE.id);
  assert.equal(
    calls.filter((name) => name === "grader_research_source_page").length,
    2,
  );
});
test("handoffs exclude unverified email and permission withdrawn during contact lookup", async () => {
  const row = {
    ownerUserId: user,
    purpose: "requested_help",
    topic: "intake",
    status: "open",
    consentVersion: HELP_CONSENT_VERSION,
    consentRecordedAt: "2026-10-16T12:00:00Z",
  };
  const unverified = store(
    async () => [row],
    async () => null,
  );
  assert.equal(
    (await unverified.leadCsv("requested_help")).includes("example.com"),
    false,
  );
  let withdrawn = false;
  const withdrawing = store(
    async () => (withdrawn ? [] : [row]),
    async () => {
      withdrawn = true;
      return "optin@example.com";
    },
  );
  assert.equal(
    (await withdrawing.leadCsv("requested_help")).includes("optin@example.com"),
    false,
  );
});
