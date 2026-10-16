import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "../catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "../demo";
import { assessPractice } from "../scoring";
import type { SavedAssessment } from "../storage";
import { AccountDataError } from "../account/validation";
import { createAccountStore } from "./account-store";
import type { PersistedScan } from "./scan-store";
import type { WebsiteScanResult } from "../website/types";

const user = "939e04bb-5fc0-4558-a171-bb2c65e934f7";
const cloudId = "8d0f1d4c-040d-433a-97a7-3d047c305212";
const makeReport = (): SavedAssessment => ({
  id: "13be04bb-5fc0-4558-a171-bb2c65e934f7",
  practiceId: "631a03e4-12db-4244-be83-cdf017d4c17c",
  createdAt: "2026-10-15T20:00:00.000Z",
  label: "Account test practice",
  isSample: false,
  assessment: assessPractice({
    context: SAMPLE_CONTEXT,
    answers: SAMPLE_ANSWERS,
    controls: SAMPLE_CONTROLS,
    release: DEFAULT_RELEASE,
  }),
});
const cloud = (snapshot = makeReport()) => ({
  id: cloudId,
  snapshot,
  savedAt: "2026-10-15T20:10:00.000Z",
  actionProgress: [],
  canonical: true,
});
const deps = (
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) => ({
  rpc,
  readScan: async (): Promise<PersistedScan | null> => null,
  approvedRelease: async () => DEFAULT_RELEASE,
});
test("account adapter supplies server-derived ownership and never passes scan capabilities to persistence", async () => {
  const report = makeReport();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const store = createAccountStore(
    deps(async (name, args) => {
      calls.push({ name, args });
      return { created: true, report: cloud(report) };
    }),
  );
  await store.saveReport(user, {
    report,
    websiteAccess: { scanId: cloudId, accessToken: "a".repeat(43) },
  });
  assert.equal(calls[0].args.p_user_id, user);
  assert.match(calls[0].args.p_content_hash as string, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(calls).includes("accessToken"));
  assert.ok(!JSON.stringify(calls).includes("a".repeat(43)));
});
test("account read and delete always scope opaque report IDs to the authenticated owner", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const store = createAccountStore(
    deps(async (name, args) => {
      calls.push(args);
      return name === "grader_delete_report" ? true : { error: "not_found" };
    }),
  );
  await assert.rejects(
    store.readReport(user, cloudId),
    (error: unknown) =>
      error instanceof AccountDataError && error.status === 404,
  );
  await store.deleteReport(user, cloudId);
  assert.deepEqual(calls, [
    { p_user_id: user, p_report_id: cloudId },
    { p_user_id: user, p_report_id: cloudId },
  ]);
});
test("account report ID collisions and stale action revisions are explicit conflicts", async () => {
  const store = createAccountStore(
    deps(async (name) => ({
      error:
        name === "grader_save_report" ? "report_conflict" : "revision_conflict",
    })),
  );
  await assert.rejects(
    store.saveReport(user, { report: makeReport() }),
    (error: unknown) =>
      error instanceof AccountDataError && error.code === "report_conflict",
  );
  await assert.rejects(
    store.updateAction(user, cloudId, {
      actionId: "cash-review",
      state: "done",
      revision: 0,
    }),
    (error: unknown) =>
      error instanceof AccountDataError && error.code === "revision_conflict",
  );
});
test("browser-only releases never reach cloud persistence", async () => {
  let calls = 0;
  const store = createAccountStore({
    ...deps(async () => {
      calls++;
      return null;
    }),
    approvedRelease: async () => null,
  });
  await assert.rejects(
    store.saveReport(user, { report: makeReport() }),
    (error: unknown) =>
      error instanceof AccountDataError &&
      error.code === "noncanonical_release",
  );
  assert.equal(calls, 0);
});
function website(): WebsiteScanResult {
  return {
    scannerVersion: "website-scan-v1",
    rubricVersion: "website-rubric-v1",
    status: "unavailable",
    submittedUrl: "https://juniper.example/",
    finalUrl: null,
    startedAt: "2026-10-15T19:00:00.000Z",
    completedAt: "2026-10-15T19:00:01.000Z",
    durationMs: 1000,
    pages: [],
    findings: [],
    score: null,
    coverage: 0,
    measuredChecks: 0,
    totalChecks: 0,
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
      fetchedAt: "2026-10-15T19:00:01.000Z",
      sourceUrl: "https://juniper.example/",
      categories: {},
      metrics: [],
      opportunities: [],
    },
    warnings: [],
    limitations: [],
  };
}
test("website evidence needs its original capability and is imported only from matching server evidence", async () => {
  const report = makeReport();
  report.assessment = assessPractice({
    context: { ...SAMPLE_CONTEXT, websiteUrl: "https://juniper.example/" },
    answers: SAMPLE_ANSWERS,
    controls: SAMPLE_CONTROLS,
    release: DEFAULT_RELEASE,
  });
  report.websiteScan = website();
  let rpcCalls = 0;
  const base = deps(async () => {
    rpcCalls++;
    return { created: true, report: cloud(report) };
  });
  const noProof = createAccountStore(base);
  await assert.rejects(
    noProof.saveReport(user, { report }),
    (error: unknown) =>
      error instanceof AccountDataError &&
      error.code === "website_evidence_unverified",
  );
  await assert.rejects(
    noProof.saveReport(user, {
      report,
      websiteAccess: { scanId: cloudId, accessToken: "b".repeat(43) },
    }),
    (error: unknown) =>
      error instanceof AccountDataError &&
      error.code === "website_evidence_unverified",
  );
  assert.equal(rpcCalls, 0);
  const proven = createAccountStore({
    ...base,
    readScan: async (id, digest) => {
      assert.equal(id, cloudId);
      assert.match(digest, /^[a-f0-9]{64}$/);
      assert.notEqual(digest, "b".repeat(43));
      return {
        scanId: cloudId,
        status: "unavailable",
        stage: "Complete",
        createdAt: report.createdAt,
        updatedAt: report.createdAt,
        expiresAt: "2099-01-01T00:00:00Z",
        result: report.websiteScan,
      };
    },
  });
  assert.equal(
    (
      await proven.saveReport(user, {
        report,
        websiteAccess: { scanId: cloudId, accessToken: "b".repeat(43) },
      })
    ).report.canonical,
    true,
  );
  assert.equal(rpcCalls, 1);
});
