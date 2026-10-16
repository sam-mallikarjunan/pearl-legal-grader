import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "../catalog";
import { SAMPLE_CONTEXT, SAMPLE_ANSWERS, SAMPLE_CONTROLS } from "../demo";
import { assessPractice } from "../scoring";
import type { CloudReport } from "../account/types";
import { AccountDataError } from "../account/validation";
import {
  createReportEmailService,
  parseReportEmailRequest,
  renderReportEmail,
  reportEmailConfiguration,
  ReportEmailRetry,
  ReportEmailUnavailable,
} from "./report-email";

const user = {
  id: "939e04bb-5fc0-4558-a171-bb2c65e934f7",
  email: "verified@example.invalid",
};
const reportId = "8d0f1d4c-040d-433a-97a7-3d047c305212";
const requestId = "a2bf04bb-5fc0-4558-a171-bb2c65e934f7";
const outboxId = "9780410c-1dc0-4b82-a272-b4e3add6a081";
const providerId = "5297ad82-c04a-40c2-92d9-9e4bbf4306e9";
const configuration = () => ({
  enabled: true,
  key: "re_unit_test_placeholder_key",
  from: "Pearl Grader <grader@example.invalid>",
  appUrl: "https://pearl-legal-grader.vercel.app",
  hashSecret: "synthetic-unit-test-secret-32-characters",
});
const report = (): CloudReport => ({
  id: reportId,
  canonical: true,
  savedAt: "2026-10-15T20:00:00Z",
  actionProgress: [],
  snapshot: {
    id: requestId,
    practiceId: reportId,
    isSample: false,
    label: "PRIVATE PRACTICE LABEL",
    createdAt: "2026-10-15T20:00:00Z",
    assessment: assessPractice({
      context: SAMPLE_CONTEXT,
      answers: SAMPLE_ANSWERS,
      controls: SAMPLE_CONTROLS,
      release: DEFAULT_RELEASE,
    }),
  },
});
const metadata = () => ({
  id: outboxId,
  status: "queued",
  requestedAt: "2026-10-15T20:00:00Z",
  updatedAt: "2026-10-15T20:00:00Z",
});
const message = () => renderReportEmail(report(), user.email, configuration());
const dependencies = (
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  fetcher: typeof fetch = async () => {
    throw new Error("No real provider calls allowed");
  },
) => ({
  rpc,
  fetch: fetcher,
  configuration,
  readUser: async () => ({ ...user, confirmed: true }),
  readReport: async () => report(),
});

test("requested report email is explicitly gated by sender, key, app URL and hash configuration", () => {
  const env = {
    REPORT_EMAIL_ENABLED: "true",
    RESEND_API_KEY: "re_unit_test_placeholder_key",
    GRADER_EMAIL_FROM: "Pearl Grader <grader@example.invalid>",
    SCAN_HASH_SECRET: "synthetic-unit-test-secret-32-characters",
  };
  assert.equal(reportEmailConfiguration(env).enabled, true);
  assert.equal(
    reportEmailConfiguration({ ...env, REPORT_EMAIL_ENABLED: "false" }).enabled,
    false,
  );
  assert.equal(
    reportEmailConfiguration({
      ...env,
      GRADER_EMAIL_FROM: "bad\r\nBcc: other@example.invalid",
    }).enabled,
    false,
  );
  assert.equal(
    reportEmailConfiguration({
      ...env,
      GRADER_APP_URL: "https://attacker.example/account?token=secret",
    }).enabled,
    false,
  );
  assert.equal(
    reportEmailConfiguration({ ...env, SCAN_HASH_SECRET: "" }).enabled,
    false,
  );
});
test("email requests cannot specify recipients, payloads, sender or account ownership", () => {
  assert.deepEqual(parseReportEmailRequest({ requestId }), { requestId });
  for (const body of [
    { requestId, to: "other@example.invalid" },
    { requestId, email: user.email },
    { requestId, html: "arbitrary" },
    { requestId, ownerUserId: user.id },
    { requestId: "not-a-uuid" },
  ])
    assert.throws(() => parseReportEmailRequest(body), AccountDataError);
});
test("report email summarizes scope and three safe actions without private labels, answers or financial/control details", () => {
  const value = report();
  value.snapshot.assessment = structuredClone(value.snapshot.assessment);
  const first = value.snapshot.assessment.actions[0];
  value.snapshot.assessment.actions = [
    { ...first, title: "<script>alert('x')</script>", domain: "intake" },
    { ...first, title: "PRIVATE FINANCIAL DETAIL", domain: "cash" },
    {
      ...first,
      title: "PRIVATE CONTROL DETAIL",
      trigger: { type: "control", controlId: "mfa" },
    },
  ];
  const rendered = renderReportEmail(value, user.email, configuration());
  assert.deepEqual(rendered.to, [user.email]);
  assert.ok(rendered.html.includes("&lt;script&gt;"));
  assert.ok(!rendered.html.includes("<script>"));
  for (const hidden of [
    "PRIVATE PRACTICE LABEL",
    "PRIVATE FINANCIAL DETAIL",
    "PRIVATE CONTROL DETAIL",
    "accessToken",
    "SAMPLE_ANSWERS",
  ]) {
    assert.ok(!rendered.html.includes(hidden));
    assert.ok(!rendered.text.includes(hidden));
  }
  assert.equal((rendered.html.match(/<li /g) || []).length, 3);
  assert.ok(rendered.html.includes('<html lang="en" dir="ltr">'));
  assert.ok(rendered.html.includes('<div lang="en" dir="ltr"'));
  assert.ok(
    rendered.html.includes("https://pearl-legal-grader.vercel.app/account"),
  );
  assert.ok(
    rendered.text.includes(
      "not a legal skill, licensing or compliance certification",
    ),
  );
});
test("reservation derives one verified recipient and stable privacy-preserving account quota hash", async () => {
  let args: Record<string, unknown> | undefined;
  const service = createReportEmailService(
    dependencies(async (name, input) => {
      assert.equal(name, "grader_reserve_report_email");
      args = input;
      return { email: metadata(), start: true, created: true };
    }),
  );
  const result = await service.reserve(user, reportId, { requestId });
  assert.equal(result.email.status, "queued");
  assert.equal(args!.p_user_id, user.id);
  assert.equal(args!.p_recipient, user.email);
  assert.match(args!.p_account_hash as string, /^[a-f0-9]{64}$/);
  assert.ok(!String(args!.p_account_hash).includes(user.id));
  assert.deepEqual((args!.p_message as { to: string[] }).to, [user.email]);
});
test("disabled service and unowned saved reports never enqueue or call a provider", async () => {
  let calls = 0;
  const base = dependencies(async () => {
    calls++;
    return null;
  });
  const disabled = createReportEmailService({
    ...base,
    configuration: () => ({ ...configuration(), enabled: false }),
  });
  await assert.rejects(
    disabled.reserve(user, reportId, { requestId }),
    ReportEmailUnavailable,
  );
  const denied = createReportEmailService({
    ...base,
    readReport: async () => {
      throw new AccountDataError("not_found", "Unavailable", 404);
    },
  });
  await assert.rejects(
    denied.reserve(user, reportId, { requestId }),
    AccountDataError,
  );
  assert.equal(calls, 0);
});
test("ambiguous timeout retries the exact frozen message and same Resend idempotency key", async () => {
  let attempt = 0;
  const posts: Array<{ url: string; body: unknown; key: string | null }> = [];
  const frozen = message();
  const service = createReportEmailService(
    dependencies(
      async (name, args) => {
        if (name === "grader_claim_report_email")
          return {
            id: outboxId,
            ownerUserId: user.id,
            recipientEmail: user.email,
            revision: ++attempt,
            attempt,
            message: frozen,
          };
        if (name === "grader_finish_report_email") {
          if (attempt === 1) assert.equal(args.p_status, "queued");
          else assert.equal(args.p_status, "accepted");
          return true;
        }
        throw new Error("Unexpected RPC");
      },
      async (url, init) => {
        posts.push({
          url: String(url),
          body: init?.body,
          key: new Headers(init?.headers).get("Idempotency-Key"),
        });
        if (posts.length === 1)
          throw new Error("Synthetic timeout containing private provider data");
        return Response.json({ id: providerId });
      },
    ),
  );
  await assert.rejects(
    service.process(outboxId, "workflow-run"),
    ReportEmailRetry,
  );
  assert.deepEqual(await service.process(outboxId, "workflow-run"), {
    status: "accepted",
  });
  assert.deepEqual(posts[0], posts[1]);
  assert.equal(posts[0].url, "https://api.resend.com/emails");
  assert.equal(posts[0].key, `pearl-report/${outboxId}`);
});
test("provider acceptance is recorded distinctly from delivery and permanent rejections are not retried", async () => {
  const finishes: Record<string, unknown>[] = [];
  const base = async (name: string, args: Record<string, unknown>) => {
    if (name === "grader_claim_report_email")
      return {
        id: outboxId,
        ownerUserId: user.id,
        recipientEmail: user.email,
        revision: 1,
        attempt: 1,
        message: message(),
      };
    finishes.push(args);
    return true;
  };
  const rejected = createReportEmailService(
    dependencies(base, async () =>
      Response.json({ error: "RAW PRIVATE PROVIDER ERROR" }, { status: 403 }),
    ),
  );
  assert.deepEqual(await rejected.process(outboxId, "run"), {
    status: "failed",
  });
  assert.equal(finishes[0].p_error_code, "provider_rejected");
  assert.ok(!JSON.stringify(finishes).includes("RAW PRIVATE"));
  const accepted = createReportEmailService(
    dependencies(base, async () => Response.json({ id: providerId })),
  );
  assert.deepEqual(await accepted.process(outboxId, "run"), {
    status: "accepted",
  });
  assert.equal(finishes[1].p_status, "accepted");
  assert.equal(finishes[1].p_provider_id, providerId);
  assert.ok(!JSON.stringify(finishes).includes("delivered"));
});
test("rate limits use bounded Retry-After and the fourth transient attempt terminates", async () => {
  let attempt = 1;
  let finished: Record<string, unknown> | undefined;
  const service = createReportEmailService(
    dependencies(
      async (name, args) => {
        if (name === "grader_claim_report_email")
          return {
            id: outboxId,
            ownerUserId: user.id,
            recipientEmail: user.email,
            revision: attempt,
            attempt,
            message: message(),
          };
        finished = args;
        return true;
      },
      async () =>
        new Response("private-rate-limit-body", {
          status: 429,
          headers: { "retry-after": "99999" },
        }),
    ),
  );
  await assert.rejects(
    service.process(outboxId, "run"),
    (error: unknown) =>
      error instanceof ReportEmailRetry && error.retryAfterSeconds === 300,
  );
  attempt = 4;
  assert.deepEqual(await service.process(outboxId, "run"), {
    status: "failed",
  });
  assert.equal(finished!.p_error_code, "retry_exhausted");
});
test("an already terminal or deleted outbox is skipped without provider side effects", async () => {
  let calls = 0;
  const service = createReportEmailService(
    dependencies(
      async () => null,
      async () => {
        calls++;
        return Response.json({ id: providerId });
      },
    ),
  );
  assert.deepEqual(await service.process(outboxId, "run"), {
    status: "skipped",
  });
  assert.equal(calls, 0);
});
test("switching sending off after enqueue leaves a visible unavailable status without sending", async () => {
  let calls = 0;
  let finish: Record<string, unknown> | undefined;
  const base = dependencies(
    async (name, args) => {
      if (name === "grader_claim_report_email")
        return {
          id: outboxId,
          ownerUserId: user.id,
          recipientEmail: user.email,
          revision: 1,
          attempt: 1,
          message: message(),
        };
      finish = args;
      return true;
    },
    async () => {
      calls++;
      return Response.json({ id: providerId });
    },
  );
  const service = createReportEmailService({
    ...base,
    configuration: () => ({ ...configuration(), enabled: false }),
  });
  assert.deepEqual(await service.process(outboxId, "run"), {
    status: "unavailable",
  });
  assert.equal(calls, 0);
  assert.equal(finish!.p_error_code, "configuration_unavailable");
});

test("deleted, unverified or changed account recipients stop a queued request before sending", async () => {
  for (const recipient of [
    null,
    { ...user, confirmed: false },
    { ...user, email: "changed@example.invalid", confirmed: true },
  ]) {
    let sends = 0;
    let finish: Record<string, unknown> | undefined;
    const base = dependencies(
      async (name, args) => {
        if (name === "grader_claim_report_email")
          return {
            id: outboxId,
            ownerUserId: user.id,
            recipientEmail: user.email,
            revision: 1,
            attempt: 1,
            message: message(),
          };
        finish = args;
        return true;
      },
      async () => {
        sends++;
        return Response.json({ id: providerId });
      },
    );
    const service = createReportEmailService({
      ...base,
      readUser: async () => recipient,
    });
    assert.deepEqual(await service.process(outboxId, "run"), {
      status: "unavailable",
    });
    assert.equal(sends, 0);
    assert.equal(finish!.p_error_code, "recipient_changed");
  }
});

test("a frozen message cannot change the verified recipient or its signed delivery correlation", async () => {
  for (const frozen of [
    { ...message(), to: ["other@example.invalid"] },
    { ...message(), tags: [{ name: "pearl_grader_report", value: reportId }] },
    { ...message(), subject: "Header\r\nBcc: other@example.invalid" },
    { ...message(), bcc: ["other@example.invalid"] },
  ]) {
    let sends = 0;
    const service = createReportEmailService(
      dependencies(
        async (name) => {
          if (name === "grader_claim_report_email")
            return {
              id: outboxId,
              ownerUserId: user.id,
              recipientEmail: user.email,
              revision: 1,
              attempt: 1,
              message: frozen,
            };
          return true;
        },
        async () => {
          sends++;
          return Response.json({ id: providerId });
        },
      ),
    );
    assert.deepEqual(await service.process(outboxId, "run"), {
      status: "failed",
    });
    assert.equal(sends, 0);
  }
});

test("account email export retains report status but excludes recipients, frozen bodies and provider credentials", async () => {
  const service = createReportEmailService(
    dependencies(async (name, args) => {
      assert.equal(name, "grader_export_report_emails");
      assert.equal(args.p_user_id, user.id);
      return [
        {
          ...metadata(),
          reportId,
          status: "delivered",
          deliveryEvent: "email.delivered",
          recipientEmail: user.email,
          message: message(),
          providerKey: "PRIVATE_PROVIDER_KEY",
        },
      ];
    }),
  );
  const exported = await service.export(user.id);
  assert.deepEqual(exported, [
    {
      ...metadata(),
      reportId,
      status: "delivered",
      deliveryEvent: "email.delivered",
    },
  ]);
  assert.ok(!JSON.stringify(exported).includes(user.email));
  assert.ok(!JSON.stringify(exported).includes("PRIVATE_PROVIDER_KEY"));
});

test("suppressed recipients surface a safe actionable status without a provider request", async () => {
  const service = createReportEmailService(
    dependencies(async () => ({ error: "email_suppressed" })),
  );
  await assert.rejects(
    service.reserve(user, reportId, { requestId }),
    (error: unknown) =>
      error instanceof AccountDataError &&
      error.code === "email_suppressed" &&
      error.status === 409,
  );
});
