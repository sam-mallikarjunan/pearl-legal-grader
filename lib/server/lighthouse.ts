import type { WebsitePerformance } from "../website/types";
import { parsePageSpeedResponse, unavailablePerformance } from "./pagespeed";
import { normalizeWebsiteUrl, resolvePublicAddress } from "./website-fetch";

/** Pinned runtime tools; installed only inside the disposable, credential-free VM. */
export const LIGHTHOUSE_RUNTIME_PACKAGES = [
  "lighthouse@13.5.0",
  "puppeteer@25.14.0",
] as const;
export const LIGHTHOUSE_SANDBOX_TIMEOUT_MS = 100_000;

// Deny rules override the public wildcard, including after a DNS rebind. IPv6 is
// deliberately disabled for this pilot instead of incompletely classifying it.
export const LIGHTHOUSE_DENIED_SUBNETS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "168.63.129.16/32",
  "::/0",
] as const;

const RUNTIME_DIRECTORY = "/vercel/sandbox";
const RUNTIME_SCRIPT = `${RUNTIME_DIRECTORY}/pearl-lighthouse.mjs`;
const RESULT_FILE = `${RUNTIME_DIRECTORY}/pearl-lighthouse-result.json`;
const CACHE_DIRECTORY = `${RUNTIME_DIRECTORY}/.chrome`;

interface SandboxCommand {
  exitCode: number | null;
  stdout(): Promise<string>;
}
interface AuditSandbox {
  runCommand(options: {
    cmd: string;
    args: string[];
    cwd?: string;
    sudo?: boolean;
    env?: Record<string, string>;
  }): Promise<SandboxCommand>;
  writeFiles(files: Array<{ path: string; content: Buffer }>): Promise<unknown>;
  readFileToBuffer(options: { path: string }): Promise<Buffer | null>;
  update(options: {
    networkPolicy: { allow: string[]; subnets: { deny: string[] } };
  }): Promise<unknown>;
  stop(): Promise<unknown>;
}

interface LighthouseSandboxBase {
  timeout: number;
  persistent: false;
  resources: { vcpus: number };
  networkPolicy: "deny-all" | { allow: string[]; subnets: { deny: string[] } };
}
export type LighthouseSandboxOptions = LighthouseSandboxBase &
  (
    | { image: "vercel/sandbox/node:24"; source?: never }
    | { source: { type: "snapshot"; snapshotId: string }; image?: never }
  );
type SandboxFactory = (
  options: LighthouseSandboxOptions,
) => Promise<AuditSandbox>;

export type LighthouseSetupStage =
  | "create"
  | "install"
  | "browserinstall"
  | "chromesmoke"
  | "snapshot";
export interface LighthouseSetupDiagnostic {
  stage: LighthouseSetupStage;
  classification:
    | "oidc_missing"
    | "provider_api_error"
    | "sdk_type_error"
    | "setup_command_failed"
    | "unknown";
  providerStatus?: number;
  providerCode?: string;
}
export class LighthouseSetupError extends Error {
  public readonly diagnostic: LighthouseSetupDiagnostic;
  constructor(
    public readonly stage: LighthouseSetupStage,
    error?: unknown,
  ) {
    super(`lighthouse_setup_${stage}`);
    this.name = "LighthouseSetupError";
    const value =
      typeof error === "object" && error !== null
        ? (error as {
            name?: unknown;
            message?: unknown;
            response?: { status?: unknown };
            json?: { error?: { code?: unknown } };
          })
        : {};
    const status = value.response?.status;
    const code = value.json?.error?.code;
    const providerStatus =
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
        ? status
        : undefined;
    const providerCode =
      typeof code === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(code)
        ? code
        : undefined;
    this.diagnostic = {
      stage,
      classification: [
        "VercelOidcContextError",
        "LocalOidcContextError",
      ].includes(String(value.name))
        ? "oidc_missing"
        : providerStatus !== undefined
          ? "provider_api_error"
          : value.name === "TypeError"
            ? "sdk_type_error"
            : value.message === "audit_command_failed"
              ? "setup_command_failed"
              : "unknown",
      ...(providerStatus === undefined ? {} : { providerStatus }),
      ...(providerCode === undefined ? {} : { providerCode }),
    };
  }
}
/** Fixed operator diagnostics only; never includes exception messages, response bodies or causes. */
export function lighthouseSetupDiagnostic(
  error: unknown,
): LighthouseSetupDiagnostic {
  return error instanceof LighthouseSetupError
    ? error.diagnostic
    : new LighthouseSetupError("create", error).diagnostic;
}
async function setupStage<T>(
  stage: LighthouseSetupStage,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new LighthouseSetupError(stage, error);
  }
}

/** Mirrors the SDK's documented stale-snapshot detection; never retries auth/quota failures. */
export function isExpiredLighthouseSnapshot(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as {
    response?: { status?: unknown };
    json?: { error?: { code?: unknown } };
  };
  return (
    value.response?.status === 410 &&
    value.json?.error?.code === "snapshot_not_found"
  );
}

/** Counts actual CDP traffic, including compressed/chunked responses without Content-Length. */
export function createLighthouseTransferBudget(limit = 25_000_000) {
  let encoded = 0;
  let decoded = 0;
  return {
    add(encodedBytes: number, decodedBytes: number): boolean {
      if (Number.isFinite(encodedBytes) && encodedBytes > 0)
        encoded += encodedBytes;
      if (Number.isFinite(decodedBytes) && decodedBytes > 0)
        decoded += decodedBytes;
      return encoded > limit || decoded > limit;
    },
  };
}

/** Bounded JSON conversion shared with PSI, without presenting a self-run audit as Google-hosted. */
export function parseSandboxLighthouseResponse(
  payload: unknown,
  sourceUrl: string,
  fetchedAt = new Date().toISOString(),
): WebsitePerformance {
  const result = parsePageSpeedResponse(
    { lighthouseResult: payload },
    sourceUrl,
    fetchedAt,
  );
  if (result.status === "unavailable")
    return {
      ...unavailablePerformance(
        sourceUrl,
        "The isolated mobile Lighthouse audit returned no usable measurements. Unmeasured checks do not reduce your score.",
      ),
      provider: "vercel-lighthouse",
    };
  return { ...result, provider: "vercel-lighthouse" };
}

/** Static trusted program. The URL is a separate JSON data file, never executable text. */
export function lighthouseRuntimeScript(): string {
  return String.raw`import fs from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import puppeteer from "puppeteer";
import lighthouse from "lighthouse";

const input = JSON.parse(await fs.readFile("/vercel/sandbox/pearl-lighthouse-input.json", "utf8"));
const target = new URL(input.url);
const deny = ${JSON.stringify(LIGHTHOUSE_DENIED_SUBNETS.filter((range) => !range.includes(":")))};
const privatePath = /(?:^|\/)(?:login|log-in|client-login|clientlogin|signin|sign-in|signout|logout|account|accounts|my-account|client-portal|clientportal|portal|wp-admin|wp-login\.php|admin|dashboard|private|auth|oauth|checkout|cart|payment|payments|pay-invoice|reset-password|password)(?:\/|\.|$)/i;
const dnsCache = new Map();
let requests = 0;
let blocked = 0;
let navigationCount = 0;
const transferBudget = (${createLighthouseTransferBudget.toString()})(25_000_000);
const encodedByRequest = new Map();
let budgetExceeded = false;
let audit;
let browser;
const deadline = setTimeout(() => process.exit(2), 42_000);

function publicV4(address) {
  if (isIP(address) !== 4) return false;
  const value = address.split(".").reduce((n, octet) => n * 256 + Number(octet), 0) >>> 0;
  return !deny.some((range) => {
    const [base, bits] = range.split("/");
    const n = base.split(".").reduce((v, octet) => v * 256 + Number(octet), 0) >>> 0;
    const mask = (0xffffffff << (32 - Number(bits))) >>> 0;
    return ((value & mask) >>> 0) === ((n & mask) >>> 0);
  });
}

async function publicHost(host) {
  if (isIP(host)) return publicV4(host);
  if (!host.includes(".") || host.endsWith(".") || /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example|onion|arpa)$/.test(host)) return false;
  if (!dnsCache.has(host)) dnsCache.set(host, lookup(host, { all: true, family: 4 }).then((answers) => answers.length > 0 && answers.length <= 64 && answers.every((answer) => publicV4(answer.address))).catch(() => false));
  return await dnsCache.get(host);
}

async function allowed(request) {
  if (++requests > 250 || !["GET", "HEAD"].includes(request.method())) return false;
  let url;
  try { url = new URL(request.url()); } catch { return false; }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return false;
  let path = url.pathname;
  try { for (let i = 0; i < 3; i++) path = decodeURIComponent(path); } catch { return false; }
  if (privatePath.test(path) || /[\u0000-\u001f\u007f\\]/.test(path)) return false;
  if (request.isNavigationRequest()) {
    // Audit one public page only. No embedded forms or cross-origin documents.
    if (url.origin !== target.origin || url.pathname !== target.pathname || url.search || ++navigationCount > 3) return false;
  }
  return await publicHost(url.hostname.replace(/^\[|\]$/g, ""));
}

try {
  browser = await puppeteer.launch({
    headless: true,
    timeout: 10_000,
    ignoreDefaultArgs: ["--disable-popup-blocking"],
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-quic", "--disable-background-networking", "--disable-extensions", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--disable-features=MediaRouter"],
  });
  const page = await browser.newPage();
  await page.setBypassServiceWorker(true);
  await page.evaluateOnNewDocument(() => {
    // Defense in depth; the VM subnet firewall remains the network boundary.
    for (const name of ["Worker", "SharedWorker", "WebSocket", "EventSource", "RTCPeerConnection", "webkitRTCPeerConnection"]) {
      try { Object.defineProperty(globalThis, name, { value: class { constructor() { throw new Error("Unavailable during a bounded website audit"); } }, writable: false, configurable: false }); } catch {}
    }
    try { Object.defineProperty(window, "open", { value: () => null, writable: false, configurable: false }); } catch {}
    for (const name of ["submit", "requestSubmit"]) try { Object.defineProperty(HTMLFormElement.prototype, name, { value() { throw new Error("Forms are not submitted by this audit"); }, writable: false, configurable: false }); } catch {}
    try { if (navigator.serviceWorker) Object.defineProperty(navigator.serviceWorker, "register", { value: () => Promise.reject(new Error("Unavailable during an audit")), writable: false, configurable: false }); } catch {}
  });
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  const stopForBudget = () => { budgetExceeded = true; browser.close().catch(() => {}); };
  cdp.on("Network.dataReceived", (event) => {
    encodedByRequest.set(event.requestId, (encodedByRequest.get(event.requestId) ?? 0) + event.encodedDataLength);
    if (transferBudget.add(event.encodedDataLength, event.dataLength)) stopForBudget();
  });
  cdp.on("Network.loadingFinished", (event) => {
    const remaining = Math.max(0, event.encodedDataLength - (encodedByRequest.get(event.requestId) ?? 0));
    encodedByRequest.delete(event.requestId);
    if (transferBudget.add(remaining, 0)) stopForBudget();
  });
  cdp.on("Network.loadingFailed", (event) => encodedByRequest.delete(event.requestId));
  await page.setRequestInterception(true);
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
  page.on("popup", (popup) => popup.close().catch(() => {}));
  page.on("request", async (request) => {
    try {
      if (await allowed(request)) await request.continue();
      else { blocked++; await request.abort("blockedbyclient"); }
    } catch { blocked++; await request.abort("blockedbyclient").catch(() => {}); }
  });
  page.on("response", (response) => {
    const length = Number(response.headers()["content-length"]);
    if (Number.isFinite(length) && length > 25_000_000) stopForBudget();
  });
  audit = await lighthouse(target.href, {
    output: "json", logLevel: "error", formFactor: "mobile",
    onlyCategories: ["performance", "accessibility", "seo", "best-practices"],
    maxWaitForFcp: 12_000, maxWaitForLoad: 20_000,
    disableStorageReset: true,
  }, undefined, page);
  if (budgetExceeded || !audit?.lhr || audit.lhr.runtimeError) throw new Error("no_measurements");
  // Keep the small audit measurements only. No HTML, screenshots, URLs or trace.
  const lhr = audit.lhr;
  const summary = { lighthouseVersion: lhr.lighthouseVersion, categories: Object.fromEntries(Object.entries(lhr.categories ?? {}).map(([id, category]) => [id, { score: category.score }])), audits: {} };
  for (const [id, entry] of Object.entries(lhr.audits ?? {}).slice(0, 500)) summary.audits[id] = { score: entry.score, title: entry.title, description: entry.description, numericValue: entry.numericValue, details: { overallSavingsMs: entry.details?.overallSavingsMs } };
  await fs.writeFile("/vercel/sandbox/pearl-lighthouse-result.json", JSON.stringify(summary));
} catch {
  process.exitCode = 2;
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
}
`;
}

const noMeasurements = (url: string): WebsitePerformance => ({
  ...unavailablePerformance(
    url,
    "The isolated mobile Lighthouse audit did not finish within this pilot's scan window. Website observations remain useful; unmeasured checks do not reduce your score.",
  ),
  provider: "vercel-lighthouse",
});

async function auditCommand(
  sandbox: AuditSandbox,
  cmd: string,
  args: string[],
  sudo = false,
) {
  const result = await sandbox.runCommand({
    cmd,
    args,
    cwd: RUNTIME_DIRECTORY,
    sudo,
    env: { PUPPETEER_CACHE_DIR: CACHE_DIRECTORY },
  });
  if (result.exitCode !== 0) throw new Error("audit_command_failed");
}

async function bootstrapRuntime(sandbox: AuditSandbox) {
  await setupStage("install", () =>
    Promise.all([
      auditCommand(sandbox, "npm", [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--save-exact",
        ...LIGHTHOUSE_RUNTIME_PACKAGES,
      ]),
      auditCommand(sandbox, "apt-get", ["update"], true),
    ]),
  );
  await setupStage("browserinstall", () =>
    auditCommand(
      sandbox,
      `${RUNTIME_DIRECTORY}/node_modules/.bin/puppeteer`,
      ["browsers", "install", "chrome", "--install-deps"],
      true,
    ),
  );
}

/** Injectable only to test lifecycle and fail-closed behavior without creating billable VMs. */
export function createSandboxLighthouseRunner(
  createSandbox: SandboxFactory,
  validateAddress = resolvePublicAddress,
  snapshotId?: string,
) {
  return async (input: string): Promise<WebsitePerformance> => {
    // Never echo rejected userinfo or query tokens through the result contract.
    let sourceUrl = "https://unavailable.invalid/";
    let sandbox: AuditSandbox | undefined;
    try {
      const url = normalizeWebsiteUrl(input);
      sourceUrl = url.href;
      await validateAddress(url);
      const restrictedNetwork = {
        allow: ["*"],
        subnets: { deny: [...LIGHTHOUSE_DENIED_SUBNETS] },
      };
      const options: LighthouseSandboxBase = {
        timeout: LIGHTHOUSE_SANDBOX_TIMEOUT_MS,
        persistent: false,
        resources: { vcpus: 2 },
        // Bootstrap has no website content or secrets. Audit content is loaded only
        // after the native policy has been restricted below.
        // Ubuntu's package mirrors use HTTP, so domain-only SNI filtering would
        // prevent browser setup. Both phases still deny private/special IPs.
        networkPolicy: restrictedNetwork,
      };
      let usingSnapshot = Boolean(snapshotId);
      try {
        sandbox = await createSandbox({
          ...options,
          ...(snapshotId
            ? { source: { type: "snapshot" as const, snapshotId } }
            : { image: "vercel/sandbox/node:24" as const }),
        });
      } catch (error) {
        if (!snapshotId || !isExpiredLighthouseSnapshot(error)) throw error;
        usingSnapshot = false;
        sandbox = await createSandbox({
          ...options,
          image: "vercel/sandbox/node:24",
        });
      }
      if (!usingSnapshot) await bootstrapRuntime(sandbox);
      await sandbox.writeFiles([
        {
          path: "pearl-lighthouse-input.json",
          content: Buffer.from(JSON.stringify({ url: url.href })),
        },
        {
          path: "pearl-lighthouse.mjs",
          content: Buffer.from(lighthouseRuntimeScript()),
        },
      ]);
      await sandbox.update({ networkPolicy: restrictedNetwork });
      await auditCommand(sandbox, "node", [RUNTIME_SCRIPT]);
      const result = await sandbox.readFileToBuffer({ path: RESULT_FILE });
      if (!result || result.byteLength > 1_000_000)
        return noMeasurements(sourceUrl);
      return parseSandboxLighthouseResponse(
        JSON.parse(result.toString("utf8")),
        sourceUrl,
      );
    } catch {
      return noMeasurements(sourceUrl);
    } finally {
      // The VM also has a hard provider timeout if stopping fails or the caller exits.
      await sandbox?.stop().catch(() => {});
    }
  };
}

/** Uses the deployment's scoped OIDC automatically; no app credential enters the VM. */
export async function runSandboxLighthouse(
  input: string,
): Promise<WebsitePerformance> {
  return createSandboxLighthouseRunner(
    async (options) => {
      const { Sandbox } = await import("@vercel/sandbox");
      return await Sandbox.create({ ...options });
    },
    resolvePublicAddress,
    process.env.LIGHTHOUSE_SANDBOX_SNAPSHOT_ID,
  )(input);
}

/** Operator-only setup: package/browser files only, no website data or credentials. */
export async function prepareLighthouseSandboxSnapshot(): Promise<{
  snapshotId: string;
}> {
  const { Sandbox } = await import("@vercel/sandbox");
  const sandbox = await setupStage("create", () =>
    Sandbox.create({
      image: "vercel/sandbox/node:24",
      timeout: LIGHTHOUSE_SANDBOX_TIMEOUT_MS,
      persistent: false,
      resources: { vcpus: 2 },
      networkPolicy: {
        allow: ["*"],
        subnets: { deny: [...LIGHTHOUSE_DENIED_SUBNETS] },
      },
    }),
  );
  let snapshotted = false;
  try {
    await bootstrapRuntime(sandbox);
    await setupStage("chromesmoke", () =>
      auditCommand(sandbox, "node", [
        "--input-type=module",
        "-e",
        'import puppeteer from "puppeteer"; const browser = await puppeteer.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]}); await browser.close();',
      ]),
    );
    const snapshot = await setupStage("snapshot", () =>
      sandbox.snapshot({
        expiration: 30 * 24 * 60 * 60 * 1000,
      }),
    );
    snapshotted = true;
    return { snapshotId: snapshot.snapshotId };
  } finally {
    // snapshot() stops its own sandbox. Never leave a failed preparation running.
    if (!snapshotted) await sandbox.stop().catch(() => {});
  }
}
