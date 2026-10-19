import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createOutcomePlanStore } from "./outcome-plan-store";
import { DEFAULT_RELEASE } from "../catalog";
import { SAMPLE_CONTEXT, SAMPLE_ANSWERS, SAMPLE_CONTROLS } from "../demo";
import { assessPractice } from "../scoring";
import { canonicalJson } from "../account/validation";
import { configurationHash } from "./config-store";
import { POST, GET } from "../../app/api/account/outcome-plans/route";
import { DELETE } from "../../app/api/account/outcome-plans/[id]/route";
import { POST as reportRoute } from "../../app/api/account/outcome-plans/[id]/report/route";
const id = "72deca47-3878-4ce7-acce-fd5e8949589f",
  user = "9780410c-1dc0-4b82-a272-b4e3add6a081";
const now = new Date("2026-10-19T12:00:00Z");
const input = {
  requestId: id,
  expectedReleaseId: DEFAULT_RELEASE.id,
  baselineReportId: id,
  startDate: "2026-11-01",
  endDate: "2026-11-30",
  source: "self_reported",
  currency: "USD",
};
const plan = {
  ...input,
  id,
  revision: 0,
  baselineReleaseId: DEFAULT_RELEASE.id,
  baselineStage: "established",
  baselineFeeModel: "hourly",
  status: "registered",
  outcomeId: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  reportedAt: null,
  withdrawnAt: null,
};
const report = {
  id,
  snapshot: {
    id,
    practiceId: id,
    createdAt: "2026-10-19T11:00:00Z",
    label: "Private baseline",
    isSample: false,
    assessment: assessPractice({
      context: SAMPLE_CONTEXT,
      answers: SAMPLE_ANSWERS,
      controls: SAMPLE_CONTROLS,
      release: DEFAULT_RELEASE,
    }),
  },
  savedAt: "2026-10-19T11:01:00Z",
  canonical: true as const,
  actionProgress: [],
};
const active = async () => ({
  release: DEFAULT_RELEASE,
  contentHash: configurationHash(DEFAULT_RELEASE),
  source: "published" as const,
  publishedAt: null,
  available: true as const,
});
function deps(rpc: any) {
  return {
    rpc,
    readReport: async () => structuredClone(report),
    activeConfig: active,
    now: () => now,
  };
}
test("registration derives verified ownership, recomputes canonical baseline and pins immutable hash", async () => {
  const calls: any[] = [];
  const s = createOutcomePlanStore(
    deps(async (name: string, args: any) => {
      calls.push({ name, args });
      return name === "grader_read_outcome_plans" ? { plans: [] } : plan;
    }),
  );
  const result = await s.create(user, input);
  assert.equal(result.id, id);
  assert.equal(calls[1].args.p_user_id, user);
  assert.equal(
    calls[1].args.p_hash,
    createHash("sha256").update(canonicalJson(report.snapshot)).digest("hex"),
  );
  assert.equal("p_snapshot" in calls[1].args, false);
  await assert.rejects(s.create(user, { ...input, ownerId: id }));
  assert.equal(calls.length, 2);
});
test("accepted request is idempotent even after start or rubric change; changed payload conflicts", async () => {
  const s = createOutcomePlanStore({
    ...deps(async () => ({ plans: [plan] })),
    now: () => new Date("2026-12-02"),
    activeConfig: async () => {
      throw new Error("must not read release for accepted retry");
    },
  });
  assert.equal((await s.create(user, input)).id, id);
  await assert.rejects(s.create(user, { ...input, currency: "EUR" }));
});
test("noncanonical, stale, sample and wrong-release baselines never register", async () => {
  for (const alter of [
    (r: any) => (r.snapshot.assessment.overallScore = 1),
    (r: any) => (r.snapshot.isSample = true),
    (r: any) => (r.snapshot.createdAt = "2026-01-01T00:00:00Z"),
    (r: any) => (r.snapshot.assessment.releaseId = "forged"),
  ]) {
    let writes = 0;
    const r = structuredClone(report);
    alter(r);
    const s = createOutcomePlanStore({
      ...deps(async (name: string) => {
        if (name === "grader_read_outcome_plans") return { plans: [] };
        writes++;
        return plan;
      }),
      readReport: async () => r,
    });
    await assert.rejects(s.create(user, input));
    assert.equal(writes, 0);
  }
});
test("withdraw is CAS and read includes retained terminal statuses without private snapshots", async () => {
  const withdrawn = {
    ...plan,
    status: "withdrawn",
    withdrawnAt: now.toISOString(),
    revision: 1,
  };
  const calls: any[] = [];
  const s = createOutcomePlanStore(
    deps(async (name: string, args: any) => {
      calls.push(args);
      return name === "grader_read_outcome_plans"
        ? { plans: [withdrawn] }
        : withdrawn;
    }),
  );
  assert.equal((await s.read(user)).plans[0].status, "withdrawn");
  await s.withdraw(user, id, { revision: 0 });
  assert.equal(calls[1].p_revision, 0);
  assert.equal(JSON.stringify(await s.read(user)).includes("snapshot"), false);
  await assert.rejects(s.withdraw(user, id, { revision: 0, ownerId: id }));
});
test("report accepts numeric values only and returns atomically matching plan and period", async () => {
  const closed = {
    ...plan,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    createdAt: "2026-08-31T12:00:00Z",
    updatedAt: "2026-08-31T12:00:00Z",
  };
  const pid = "5297ad82-c04a-40c2-92d9-9e4bbf4306e9";
  const calls: any[] = [];
  const s = createOutcomePlanStore(
    deps(async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "grader_read_outcome_plans") return { plans: [closed] };
      return {
        plan: {
          ...closed,
          status: "reported",
          outcomeId: pid,
          reportedAt: now.toISOString(),
          revision: 1,
        },
        period: {
          ...args.p_values,
          id: pid,
          revision: 0,
          startDate: closed.startDate,
          endDate: closed.endDate,
          source: "self_reported",
          currency: "USD",
          baselineReportId: id,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      };
    }),
  );
  const result = await s.report(user, id, {
    revision: 0,
    values: { inquiries: 10, clients: 2 },
  });
  assert.equal(result.period.inquiries, 10);
  assert.equal(result.period.contacted, null);
  assert.deepEqual(Object.keys(calls[1].args).sort(), [
    "p_id",
    "p_revision",
    "p_user_id",
    "p_values",
  ]);
  await assert.rejects(
    s.report(user, id, { revision: 0, values: { startDate: "forged" } }),
  );
});
test("source bounds/duplicate plans and safe machine errors fail closed", async () => {
  for (const v of [{ plans: Array(37).fill(plan) }, { plans: [plan, plan] }])
    await assert.rejects(
      createOutcomePlanStore(deps(async () => v)).read(user),
    );
  const s = createOutcomePlanStore(
    deps(async () => ({ error: "revision_conflict" })),
  );
  await assert.rejects(
    s.withdraw(user, id, { revision: 0 }),
    (e) =>
      typeof e === "object" && e !== null && "status" in e && e.status === 409,
  );
});
test("all plan mutations guard origin and all routes require verified login", async () => {
  const url = "https://example.invalid/api/account/outcome-plans";
  for (const [fn, method, path] of [
    [POST, "POST", url],
    [DELETE, "DELETE", url + "/" + id],
    [reportRoute, "POST", url + "/" + id + "/report"],
  ] as const) {
    const response = await fn(
      new Request(path, {
        method,
        headers: {
          origin: "https://attacker.invalid",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(response.status, 403);
  }
  const response = await GET(new Request(url));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});
