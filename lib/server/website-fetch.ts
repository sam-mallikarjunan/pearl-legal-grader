import { lookup as dnsLookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";

export const SCANNER_USER_AGENT =
  "PearlLegalGrader/1.0 (+https://pearl-legal-grader.vercel.app/; public website audit)";

export class WebsiteFetchError extends Error {
  constructor(
    public readonly code:
      | "unsafe_url"
      | "dns"
      | "timeout"
      | "too_large"
      | "redirect"
      | "network"
      | "content_type"
      | "robots",
    message: string,
  ) {
    super(message);
    this.name = "WebsiteFetchError";
  }
}

const IPV4_DENY: Array<[number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function ipv6Number(address: string): bigint | null {
  if (address.includes(".") || address.includes("%")) return null;
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const omitted = 8 - left.length - right.length;
  if (
    (halves.length === 1 && omitted !== 0) ||
    (halves.length === 2 && omitted < 1)
  )
    return null;
  const groups = [...left, ...Array(omitted).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g)))
    return null;
  return groups.reduce(
    (value, g) => (value << 16n) | BigInt(parseInt(g, 16)),
    0n,
  );
}

function inV6Range(ip: bigint, base: string, bits: number): boolean {
  const b = ipv6Number(base);
  return b !== null && ip >> BigInt(128 - bits) === b >> BigInt(128 - bits);
}

/** Conservative global-unicast allowlist. Mapped/transition/local addresses are rejected. */
export function isPublicIp(address: string): boolean {
  if (address.includes("%")) return false;
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    const value =
      (octets[0] * 0x1000000 +
        (octets[1] << 16) +
        (octets[2] << 8) +
        octets[3]) >>>
      0;
    return (
      !IPV4_DENY.some(([base, bits]) => {
        const mask = (0xffffffff << (32 - bits)) >>> 0;
        return (value & mask) >>> 0 === (base & mask) >>> 0;
      }) && address !== "168.63.129.16"
    ); // Azure platform virtual address.
  }
  if (isIP(address) !== 6) return false;
  const value = ipv6Number(address);
  if (value === null || !inV6Range(value, "2000::", 3)) return false;
  return ![
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
  ].some(([base, bits]) => inV6Range(value, base as string, bits as number));
}

const PRIVATE_PATH =
  /(?:^|\/)(?:login|log-in|client-login|clientlogin|signin|sign-in|signout|logout|account|accounts|my-account|client-portal|clientportal|portal|wp-admin|wp-login\.php|admin|dashboard|private|auth|oauth|checkout|cart|payment|payments|pay-invoice|reset-password|password)(?:\/|\.|$)/i;

/** Normalize public website URLs without forwarding tracking tokens, credentials or fragments. */
export function normalizeWebsiteUrl(input: string): URL {
  if (
    typeof input !== "string" ||
    input.length > 2048 ||
    /[\u0000-\u0020\u007f\\]/.test(input.trim())
  )
    throw new WebsiteFetchError(
      "unsafe_url",
      "Enter a public website URL without spaces or control characters.",
    );
  let text = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new WebsiteFetchError(
      "unsafe_url",
      "Enter a valid public website URL.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.search
  )
    throw new WebsiteFetchError(
      "unsafe_url",
      "Use a public HTTP or HTTPS website without a custom port, sign-in details or query parameters.",
    );
  url.hash = "";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host.endsWith(".") ||
    /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example|onion|arpa)$/.test(
      host,
    ) ||
    (!host.includes(".") && !host.includes(":"))
  )
    throw new WebsiteFetchError(
      "unsafe_url",
      "Private, local and reserved website addresses cannot be scanned.",
    );
  if (isIP(host) && !isPublicIp(host))
    throw new WebsiteFetchError(
      "unsafe_url",
      "Private, local and reserved website addresses cannot be scanned.",
    );
  let pathname = url.pathname;
  try {
    for (let i = 0; i < 3; i++) pathname = decodeURIComponent(pathname);
  } catch {
    throw new WebsiteFetchError("unsafe_url", "The website path is not valid.");
  }
  if (PRIVATE_PATH.test(pathname) || /[\u0000-\u001f\u007f\\]/.test(pathname))
    throw new WebsiteFetchError(
      "unsafe_url",
      "Use a public website page rather than a sign-in, account or payment page.",
    );
  return url;
}

export interface PublicAddress {
  address: string;
  family: 4 | 6;
}
export type AddressResolver = (hostname: string) => Promise<PublicAddress[]>;
const resolveAddresses: AddressResolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map(
    ({ address, family }) => ({ address, family: family as 4 | 6 }),
  );

/** Reject mixed public/private DNS answers, then pin one validated result into the socket lookup. */
export async function resolvePublicAddress(
  url: URL,
  resolver: AddressResolver = resolveAddresses,
): Promise<PublicAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (!isPublicIp(hostname))
      throw new WebsiteFetchError(
        "unsafe_url",
        "The website resolves to a non-public address.",
      );
    return { address: hostname, family: isIP(hostname) as 4 | 6 };
  }
  let addresses: PublicAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new WebsiteFetchError(
      "dns",
      "The website address could not be resolved.",
    );
  }
  if (
    !addresses.length ||
    addresses.length > 64 ||
    addresses.some(
      (a) =>
        ![4, 6].includes(a.family) ||
        isIP(a.address) !== a.family ||
        !isPublicIp(a.address),
    )
  )
    throw new WebsiteFetchError(
      "unsafe_url",
      "The website does not resolve exclusively to public addresses.",
    );
  return addresses.find((a) => a.family === 4) ?? addresses[0];
}

/** Public DNS preflight has its own short wall-clock limit before any job is reserved. */
export async function resolvePublicAddressWithin(
  url: URL,
  timeoutMs = 4000,
  resolver?: AddressResolver,
): Promise<PublicAddress> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolvePublicAddress(url, resolver),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new WebsiteFetchError(
                "timeout",
                "Website address lookup timed out. Please try again later.",
              ),
            ),
          Math.min(4000, Math.max(1, timeoutMs)),
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export interface WebsiteFetchResult {
  url: string;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  redirects: number;
}

export interface WebsiteFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowedOrigin?: string;
  accept?: "html" | "text";
  /** Optional gate checked before every request, including redirect destinations. */
  authorize?: (url: URL) => Promise<void>;
}

/** Validate redirects independently so every hop receives the original URL restrictions. */
export function validateWebsiteRedirect(
  current: URL,
  location: string,
  allowedOrigin?: string,
): URL {
  let next: URL;
  try {
    next = normalizeWebsiteUrl(new URL(location, current).href);
  } catch (error) {
    if (error instanceof WebsiteFetchError) throw error;
    throw new WebsiteFetchError(
      "redirect",
      "The website returned an invalid redirect.",
    );
  }
  if (current.protocol === "https:" && next.protocol !== "https:")
    throw new WebsiteFetchError(
      "redirect",
      "The website redirected from HTTPS to an insecure connection.",
    );
  if (allowedOrigin && next.origin !== allowedOrigin)
    throw new WebsiteFetchError(
      "redirect",
      "A page redirected outside the website being inspected.",
    );
  return next;
}

function fetchPinned(
  url: URL,
  address: PublicAddress,
  maxBytes: number,
  timeoutMs: number,
  accept: "html" | "text",
): Promise<Omit<WebsiteFetchResult, "redirects">> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (
      error?: Error,
      result?: Omit<WebsiteFetchResult, "redirects">,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      agent.destroy();
      if (error) reject(error);
      else resolve(result!);
    };
    // A per-request, non-pooling agent prevents socket reuse across revalidated hosts.
    // The URL hostname remains intact for HTTP Host and TLS certificate validation.
    const lookup: import("node:net").LookupFunction = (
      _hostname,
      _options,
      callback,
    ) => callback(null, address.address, address.family);
    const agent =
      url.protocol === "https:"
        ? new https.Agent({ keepAlive: false, lookup })
        : new http.Agent({ keepAlive: false, lookup });
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        agent,
        family: address.family,
        headers: {
          "User-Agent": SCANNER_USER_AGENT,
          Accept:
            accept === "html"
              ? "text/html,application/xhtml+xml;q=0.9"
              : "text/plain,text/html;q=0.5",
          "Accept-Encoding": "identity",
          Connection: "close",
        },
        ...(url.protocol === "https:" ? { rejectUnauthorized: true } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.destroy();
          finish(undefined, {
            url: url.href,
            status,
            headers: res.headers,
            body: "",
          });
          return;
        }
        const length = Number(res.headers["content-length"]);
        if (Number.isFinite(length) && length > maxBytes) {
          res.destroy();
          finish(
            new WebsiteFetchError(
              "too_large",
              "This page is larger than the scan limit.",
            ),
          );
          return;
        }
        const contentType = String(
          res.headers["content-type"] ?? "",
        ).toLowerCase();
        if (
          status >= 200 &&
          status < 300 &&
          !(accept === "html"
            ? /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/.test(contentType)
            : /^(?:text\/plain|text\/html)(?:;|$)/.test(contentType))
        ) {
          res.destroy();
          finish(
            new WebsiteFetchError(
              "content_type",
              "The address did not return an inspectable web page.",
            ),
          );
          return;
        }
        const encoding = String(
          res.headers["content-encoding"] ?? "identity",
        ).toLowerCase();
        let stream: Readable = res;
        if (encoding === "gzip") stream = res.pipe(createGunzip());
        else if (encoding === "br") stream = res.pipe(createBrotliDecompress());
        else if (encoding === "deflate") stream = res.pipe(createInflate());
        else if (encoding !== "identity") {
          res.destroy();
          finish(
            new WebsiteFetchError(
              "content_type",
              "The page uses an unsupported content encoding.",
            ),
          );
          return;
        }
        let wireBytes = 0;
        let bodyBytes = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          wireBytes += chunk.length;
          if (wireBytes > maxBytes) {
            res.destroy();
            stream.destroy();
            finish(
              new WebsiteFetchError(
                "too_large",
                "This page is larger than the scan limit.",
              ),
            );
          }
        });
        stream.on("data", (chunk: Buffer) => {
          bodyBytes += chunk.length;
          if (bodyBytes > maxBytes) {
            res.destroy();
            stream.destroy();
            finish(
              new WebsiteFetchError(
                "too_large",
                "This page is larger than the scan limit.",
              ),
            );
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        stream.on("error", () =>
          finish(
            new WebsiteFetchError(
              "network",
              "The page response could not be read.",
            ),
          ),
        );
        res.on("aborted", () =>
          finish(
            new WebsiteFetchError(
              "network",
              "The website closed the response before it finished.",
            ),
          ),
        );
        stream.on("end", () =>
          finish(undefined, {
            url: url.href,
            status,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("socket", (socket) => {
      socket.once("connect", () => {
        const remote = socket.remoteAddress?.replace(/^::ffff:/, "");
        const expected = address.address.toLowerCase();
        if (
          !remote ||
          (remote.toLowerCase() !== expected &&
            !(
              isIP(remote) === 6 && ipv6Number(remote) === ipv6Number(expected)
            ))
        ) {
          req.destroy();
          finish(
            new WebsiteFetchError(
              "unsafe_url",
              "The network address changed during the request.",
            ),
          );
        }
      });
    });
    req.on("error", () =>
      finish(
        new WebsiteFetchError(
          "network",
          "The website could not be reached securely. It may block automated visits.",
        ),
      ),
    );
    timer = setTimeout(() => {
      req.destroy();
      finish(
        new WebsiteFetchError(
          "timeout",
          "The website took too long to respond.",
        ),
      );
    }, timeoutMs);
    req.end();
  });
}

/** GET only, bounded body/time, DNS-pinned connections, no cookies and fully revalidated redirects. */
export async function fetchPublicWebsite(
  input: string | URL,
  options: WebsiteFetchOptions = {},
): Promise<WebsiteFetchResult> {
  let url = normalizeWebsiteUrl(String(input));
  const deadline = Date.now() + Math.min(options.timeoutMs ?? 10_000, 20_000);
  const maxBytes = Math.min(options.maxBytes ?? 1_500_000, 2_000_000);
  const maxRedirects = Math.min(options.maxRedirects ?? 3, 5);
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    if (options.allowedOrigin && url.origin !== options.allowedOrigin)
      throw new WebsiteFetchError(
        "redirect",
        "A page redirected outside the website being inspected.",
      );
    if (options.authorize) await options.authorize(url);
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new WebsiteFetchError(
        "timeout",
        "The website took too long to respond.",
      );
    // DNS resolution is itself bounded; a poisoned resolver cannot consume the entire job.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const address = await Promise.race([
      resolvePublicAddress(url),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new WebsiteFetchError(
                "timeout",
                "Website address lookup timed out.",
              ),
            ),
          Math.min(remaining, 4000),
        );
      }),
    ]).finally(() => clearTimeout(timeout));
    const result = await fetchPinned(
      url,
      address,
      maxBytes,
      Math.max(1, deadline - Date.now()),
      options.accept ?? "html",
    );
    if (![301, 302, 303, 307, 308].includes(result.status))
      return { ...result, redirects };
    if (redirects === maxRedirects || !result.headers.location)
      throw new WebsiteFetchError(
        "redirect",
        "The website has too many redirects or an incomplete redirect.",
      );
    url = validateWebsiteRedirect(
      url,
      result.headers.location,
      options.allowedOrigin,
    );
  }
  throw new WebsiteFetchError(
    "redirect",
    "The website has too many redirects.",
  );
}

export interface RobotsPolicy {
  rules: Array<{ allow: boolean; pattern: string }>;
  crawlDelaySeconds: number;
}

/** RFC 9309-style longest-match rules for this crawler or wildcard; bounded, no regex injection. */
export function parseRobots(text: string): RobotsPolicy {
  const groups: Array<{
    agents: string[];
    rules: RobotsPolicy["rules"];
    delay: number;
  }> = [];
  let current: (typeof groups)[number] | undefined;
  let hasDirectives = false;
  for (const raw of text.slice(0, 256_000).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line
      .slice(colon + 1)
      .trim()
      .slice(0, 2048);
    if (key === "user-agent") {
      if (!current || hasDirectives) {
        current = { agents: [], rules: [], delay: 0 };
        groups.push(current);
        hasDirectives = false;
      }
      current.agents.push(value.toLowerCase());
    } else if (current && ["allow", "disallow", "crawl-delay"].includes(key)) {
      hasDirectives = true;
      if (key === "crawl-delay") {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0)
          current.delay = Math.min(seconds, 86400);
      } else if (value.startsWith("/") && current.rules.length < 1000)
        current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  const specific = groups.filter((g) =>
    g.agents.some(
      (a) => a !== "*" && a.length > 0 && "pearllegalgrader".includes(a),
    ),
  );
  const selected = specific.length
    ? specific
    : groups.filter((g) => g.agents.includes("*"));
  return {
    rules: selected.flatMap((g) => g.rules),
    crawlDelaySeconds: Math.max(0, ...selected.map((g) => g.delay)),
  };
}

export function robotsAllows(policy: RobotsPolicy, url: URL): boolean {
  // Normalize UTF-8 and percent-encoded unreserved characters before matching (RFC 9309).
  const canonicalPath = (input: string) =>
    input
      .replace(/[^\x21-\x7e]/gu, (character) => encodeURIComponent(character))
      .replace(/%[0-9a-f]{2}/gi, (encoded) => {
        const character = String.fromCharCode(parseInt(encoded.slice(1), 16));
        return /^[a-z0-9._~-]$/i.test(character)
          ? character
          : encoded.toUpperCase();
      });
  const path = canonicalPath(url.pathname);
  let winner: { allow: boolean; specificity: number } | null = null;
  for (const rule of policy.rules) {
    const normalizedRule = canonicalPath(rule.pattern);
    const end = normalizedRule.endsWith("$");
    const pattern =
      (end ? normalizedRule.slice(0, -1) : normalizedRule) + (end ? "" : "*");
    // Glob matcher instead of untrusted regular expressions: no catastrophic regex backtracking.
    let p = 0,
      s = 0,
      star = -1,
      checkpoint = 0;
    while (s < path.length) {
      if (p < pattern.length && pattern[p] === path[s]) {
        p++;
        s++;
      } else if (p < pattern.length && pattern[p] === "*") {
        star = p++;
        checkpoint = s;
      } else if (star >= 0) {
        p = star + 1;
        s = ++checkpoint;
      } else break;
    }
    while (p < pattern.length && pattern[p] === "*") p++;
    if (s === path.length && p === pattern.length) {
      const specificity = normalizedRule.replace(/[*$]/g, "").length;
      if (
        !winner ||
        specificity > winner.specificity ||
        (specificity === winner.specificity && rule.allow)
      )
        winner = { allow: rule.allow, specificity };
    }
  }
  return winner?.allow ?? true;
}
