import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  createSandboxLighthouseRunner,
  createLighthouseTransferBudget,
  isExpiredLighthouseSnapshot,
  LighthouseSetupError,
  lighthouseSetupDiagnostic,
  LIGHTHOUSE_DENIED_SUBNETS,
  LIGHTHOUSE_SANDBOX_TIMEOUT_MS,
  lighthouseRuntimeScript,
  parseSandboxLighthouseResponse,
  type LighthouseSandboxOptions,
} from "./server/lighthouse";

const url = "https://firm.com/";
const fixture = {
  lighthouseVersion: "13.5.0",
  categories: {
    performance: { score: 0.73 },
    accessibility: { score: 0.92 },
    seo: { score: null },
    "best-practices": { score: Infinity },
  },
  audits: {
    "largest-contentful-paint": { numericValue: 2412.4516 },
    "cumulative-layout-shift": { numericValue: 0.08 },
    "render-blocking": {
      score: 0,
      title: "<b>Reduce blocking work</b>",
      description:
        "Read [instructions](https://firm.com/a) <script>ignored()</script>",
      details: { overallSavingsMs: 630 },
    },
  },
};
const validate = async () => ({ address: "8.8.8.8", family: 4 as const });

function fakeSandbox(
  options: {
    failingCommand?: number;
    result?: Buffer | null;
    ipv6Values?: string;
  } = {},
) {
  const events: string[] = [];
  const files = new Map<string, Buffer>();
  let calls = 0;
  return {
    events,
    files,
    async runCommand(command: {
      cmd: string;
      args: string[];
      env?: Record<string, string>;
    }) {
      events.push(`command:${command.cmd}`);
      assert.deepEqual(Object.keys(command.env ?? {}), ["PUPPETEER_CACHE_DIR"]);
      calls++;
      return {
        exitCode: options.failingCommand === calls ? 1 : 0,
        async stdout() {
          return command.cmd === "sysctl" && command.args[0] === "-n"
            ? (options.ipv6Values ?? "1\n1\n")
            : "";
        },
      };
    },
    async writeFiles(values: Array<{ path: string; content: Buffer }>) {
      events.push("write");
      for (const value of values) files.set(value.path, value.content);
    },
    async readFileToBuffer() {
      events.push("read");
      return options.result === undefined
        ? Buffer.from(JSON.stringify(fixture))
        : options.result;
    },
    async update(policy: {
      networkPolicy: { allow: string[]; subnets: { deny: string[] } };
    }) {
      events.push("restrict");
      assert.deepEqual(policy.networkPolicy.subnets.deny, [
        ...LIGHTHOUSE_DENIED_SUBNETS,
      ]);
    },
    async stop() {
      events.push("stop");
    },
  };
}

test("Lighthouse parsing retains only finite measurements and strips report markup", () => {
  const result = parseSandboxLighthouseResponse(
    fixture,
    url,
    "2026-10-15T16:00:00.000Z",
  );
  assert.equal(result.status, "available");
  assert.deepEqual(result.categories, { performance: 73, accessibility: 92 });
  assert.equal(result.metrics[0].value, 2412.452);
  assert.equal(result.opportunities[0].title, "Reduce blocking work");
  assert.equal(
    result.opportunities[0].description,
    "Read instructions ignored()",
  );
  assert.equal(result.sourceUrl, url);
});

test("failed Lighthouse runs remain unmeasured without a Google-hosted claim", () => {
  const result = parseSandboxLighthouseResponse(
    { runtimeError: { code: "NO_FCP" } },
    url,
  );
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.categories, {});
  assert.doesNotMatch(result.reason ?? "", /Google/);
});

test("snapshot audit restricts egress before execution and always stops the disposable VM", async () => {
  const sandbox = fakeSandbox();
  let captured: LighthouseSandboxOptions | undefined;
  const runner = createSandboxLighthouseRunner(
    async (options) => {
      captured = options;
      return sandbox;
    },
    validate,
    "snap_pinned",
  );
  const result = await runner(url);
  assert.equal(result.status, "available");
  assert.equal(captured?.timeout, LIGHTHOUSE_SANDBOX_TIMEOUT_MS);
  assert.equal(captured?.persistent, false);
  assert.deepEqual(captured?.source, {
    type: "snapshot",
    snapshotId: "snap_pinned",
  });
  assert.deepEqual(sandbox.events, [
    "command:sysctl",
    "command:sysctl",
    "write",
    "restrict",
    "command:node",
    "read",
    "stop",
  ]);
});

test("cold bootstrap failure stops the VM before target content executes", async () => {
  const sandbox = fakeSandbox({ failingCommand: 3 });
  const runner = createSandboxLighthouseRunner(async () => sandbox, validate);
  const result = await runner(url);
  assert.equal(result.status, "unavailable");
  assert.equal(sandbox.events.at(-1), "stop");
  assert.ok(!sandbox.events.includes("command:node"));
  assert.equal(sandbox.files.size, 0);
});

test("missing, malformed, and oversized results fail honestly and still stop", async () => {
  for (const result of [
    null,
    Buffer.from("not-json"),
    Buffer.alloc(1_000_001),
  ]) {
    const sandbox = fakeSandbox({ result });
    const runner = createSandboxLighthouseRunner(
      async () => sandbox,
      validate,
      "snap_pinned",
    );
    assert.equal((await runner(url)).status, "unavailable");
    assert.equal(sandbox.events.at(-1), "stop");
  }
});

test("unsafe targets fail before provisioning a billable VM", async () => {
  let created = 0;
  const runner = createSandboxLighthouseRunner(async () => {
    created++;
    return fakeSandbox();
  }, validate);
  for (const unsafe of [
    "http://127.0.0.1/",
    "http://169.254.169.254/",
    "https://firm.com/portal",
    "https://user:secret@firm.com/",
  ]) {
    const result = await runner(unsafe);
    assert.equal(result.status, "unavailable");
    assert.doesNotMatch(JSON.stringify(result), /user:secret/);
  }
  assert.equal(created, 0);
});

test("website URL remains JSON data and never appears in executable source or command arguments", async () => {
  const unusual = "https://firm.com/%24%28touch%20pwned%29";
  const sandbox = fakeSandbox();
  const runner = createSandboxLighthouseRunner(
    async () => sandbox,
    validate,
    "snap_pinned",
  );
  await runner(unusual);
  assert.equal(
    JSON.parse(
      sandbox.files.get("/vercel/pearl-lighthouse-input.json")!.toString(),
    ).url,
    unusual,
  );
  assert.doesNotMatch(
    sandbox.files.get("/vercel/pearl-lighthouse.mjs")!.toString(),
    /touch%20pwned/,
  );
});

test("trusted remote program has valid module syntax", () => {
  const check = spawnSync(
    process.execPath,
    ["--check", "--input-type=module"],
    { input: lighthouseRuntimeScript(), encoding: "utf8" },
  );
  assert.equal(check.status, 0, check.stderr);
});

test("actual transfer budget catches chunked downloads and decompression expansion", () => {
  const chunked = createLighthouseTransferBudget(25_000_000);
  assert.equal(chunked.add(0, 15_000_000), false);
  assert.equal(chunked.add(0, 10_000_001), true);
  const compressed = createLighthouseTransferBudget(25_000_000);
  assert.equal(compressed.add(500_000, 20_000_000), false);
  assert.equal(compressed.add(200_000, 6_000_000), true);
  const wire = createLighthouseTransferBudget(25_000_000);
  assert.equal(wire.add(25_000_001, 0), true);
});

test("only an explicit provider stale-snapshot response permits a single cold fallback", async () => {
  const stale = {
    response: { status: 410 },
    json: { error: { code: "snapshot_not_found" } },
  };
  assert.equal(isExpiredLighthouseSnapshot(stale), true);
  assert.equal(
    isExpiredLighthouseSnapshot({ response: { status: 404 } }),
    false,
  );
  assert.equal(
    isExpiredLighthouseSnapshot({
      response: { status: 403 },
      json: { error: { code: "forbidden" } },
    }),
    false,
  );
  const options: LighthouseSandboxOptions[] = [];
  const sandbox = fakeSandbox();
  const runner = createSandboxLighthouseRunner(
    async (value) => {
      options.push(value);
      if (options.length === 1) throw stale;
      return sandbox;
    },
    validate,
    "snap_expired",
  );
  assert.equal((await runner(url)).status, "available");
  assert.equal(options.length, 2);
  assert.equal(options[0].source?.snapshotId, "snap_expired");
  assert.equal(options[1].image, "vercel/sandbox/node:24");
  assert.ok(sandbox.events.includes("command:npm"));
  assert.equal(sandbox.events.at(-1), "stop");
});

test("quota and permission failures never create a replacement sandbox", async () => {
  let calls = 0;
  const runner = createSandboxLighthouseRunner(
    async () => {
      calls++;
      throw {
        response: { status: 429 },
        json: { error: { code: "rate_limited" } },
      };
    },
    validate,
    "snap_existing",
  );
  assert.equal((await runner(url)).status, "unavailable");
  assert.equal(calls, 1);
});

test("operator setup errors expose only a fixed safe stage code", () => {
  const error = new LighthouseSetupError("browserinstall");
  assert.equal(error.name, "LighthouseSetupError");
  assert.equal(error.stage, "browserinstall");
  assert.equal(error.message, "lighthouse_setup_browserinstall");
  assert.equal(error.cause, undefined);
});

test("operator diagnostics retain bounded provider codes and discard sensitive error details", () => {
  const error = new LighthouseSetupError("create", {
    response: { status: 400 },
    json: {
      error: { code: "invalid_network_policy", message: "SECRET_TOKEN" },
    },
    message: "SECRET_TOKEN",
    text: "SECRET_TOKEN",
  });
  assert.deepEqual(lighthouseSetupDiagnostic(error), {
    stage: "create",
    classification: "provider_api_error",
    providerStatus: 400,
    providerCode: "invalid_network_policy",
  });
  assert.doesNotMatch(JSON.stringify(error), /SECRET_TOKEN/);
  const rejectedCode = new LighthouseSetupError("create", {
    response: { status: 403 },
    json: { error: { code: "bad code\nSECRET_TOKEN" } },
  });
  assert.equal(lighthouseSetupDiagnostic(rejectedCode).providerCode, undefined);
  const oidcError = new Error("SECRET_TOKEN");
  oidcError.name = "VercelOidcContextError";
  assert.deepEqual(
    lighthouseSetupDiagnostic(new LighthouseSetupError("create", oidcError)),
    { stage: "create", classification: "oidc_missing" },
  );
});

test("IPv6 disable and verification fail closed before bootstrap or website execution", async () => {
  for (const options of [
    { failingCommand: 1 },
    { failingCommand: 2 },
    { ipv6Values: "0\n1\n" },
    { ipv6Values: "1\n" },
  ]) {
    const sandbox = fakeSandbox(options);
    const runner = createSandboxLighthouseRunner(
      async () => sandbox,
      validate,
      "snap_pinned",
    );
    assert.equal((await runner(url)).status, "unavailable");
    assert.equal(sandbox.events.at(-1), "stop");
    assert.ok(!sandbox.events.includes("command:node"));
    assert.ok(!sandbox.events.includes("command:npm"));
    assert.equal(sandbox.files.size, 0);
  }
  assert.ok(LIGHTHOUSE_DENIED_SUBNETS.every((range) => !range.includes(":")));
});
