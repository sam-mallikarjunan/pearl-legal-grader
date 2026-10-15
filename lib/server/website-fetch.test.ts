import test from "node:test";
import assert from "node:assert/strict";
import {
  isPublicIp,
  normalizeWebsiteUrl,
  parseRobots,
  resolvePublicAddress,
  resolvePublicAddressWithin,
  robotsAllows,
  validateWebsiteRedirect,
} from "./website-fetch";

test("public-address validation excludes IPv4 special ranges and every IPv6 local/transition form", () => {
  for (const ip of [
    "0.0.0.0",
    "10.3.4.5",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.50",
    "192.168.1.2",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "168.63.129.16",
    "::",
    "::1",
    "fe80::1",
    "fe80::1%en0",
    "fc00::1",
    "fd00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:8.8.8.8",
    "64:ff9b::a9fe:a9fe",
    "2001:db8::1",
    "2001::1",
    "2002:7f00:1::",
    "3fff::1",
    "bad-address",
  ])
    assert.equal(isPublicIp(ip), false, ip);
  for (const ip of [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.15.255.255",
    "172.32.0.0",
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
    "2a00:1450:4001:80b::200e",
  ])
    assert.equal(isPublicIp(ip), true, ip);
});

test("URL normalization blocks credentials, queries, unsafe ports and private/login paths", () => {
  assert.equal(
    normalizeWebsiteUrl("lawfirm.com/#team").href,
    "https://lawfirm.com/",
  );
  assert.equal(
    normalizeWebsiteUrl("https://lawfirm.com:443/about").href,
    "https://lawfirm.com/about",
  );
  for (const input of [
    "http://2130706433",
    "http://0x7f000001",
    "http://0177.0.0.1",
    "http://[::ffff:7f00:1]",
    "http://[fe80::1]",
    "https://user:secret@lawfirm.com",
    "https://lawfirm.com/?token=secret",
    "https://lawfirm.com:8080/",
    "https://localhost",
    "https://lawfirm.local",
    "https://lawfirm.internal",
    "file:///etc/passwd",
    "ftp://lawfirm.com",
    "https://lawfirm.com/client-portal",
    "https://lawfirm.com/wp-admin/",
    "https://lawfirm.com/%256cogin",
    "https://lawfirm.com/a/../account",
    "https://lawfirm.com/path\\evil",
    "https://lawfirm.com/path\u0000",
  ])
    assert.throws(() => normalizeWebsiteUrl(input), input);
});

test("every redirect reuses URL restrictions and same-origin subpages cannot escape", () => {
  const current = new URL("https://lawfirm.com/contact");
  assert.equal(
    validateWebsiteRedirect(current, "/contact-us", current.origin).href,
    "https://lawfirm.com/contact-us",
  );
  for (const next of [
    "http://lawfirm.com/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://user:pass@lawfirm.com/",
    "/login",
    "/?secret=1",
    "https://lawfirm.com:444/",
  ])
    assert.throws(() => validateWebsiteRedirect(current, next), next);
  assert.throws(() =>
    validateWebsiteRedirect(
      current,
      "https://elsewhere.com/contact",
      current.origin,
    ),
  );
  assert.equal(
    validateWebsiteRedirect(
      new URL("http://lawfirm.com"),
      "https://www.lawfirm.com/",
    ).href,
    "https://www.lawfirm.com/",
  );
});

test("mixed DNS answers and private rebinding are rejected before connection; public result remains pinned", async () => {
  const url = new URL("https://lawfirm.com");
  assert.deepEqual(
    await resolvePublicAddress(url, async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ]),
    { address: "8.8.8.8", family: 4 },
  );
  await assert.rejects(
    resolvePublicAddress(url, async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
  );
  await assert.rejects(
    resolvePublicAddress(url, async () => [
      { address: "::ffff:127.0.0.1", family: 6 },
    ]),
  );
  await assert.rejects(resolvePublicAddress(url, async () => []));
  await assert.rejects(
    resolvePublicAddress(url, async () => {
      throw new Error("dns failed");
    }),
  );
});

test("a stalled DNS preflight times out before reserving scan resources", async () => {
  const neverAnswers = () => new Promise<never>(() => {});
  await assert.rejects(
    resolvePublicAddressWithin(
      new URL("https://lawfirm.com"),
      10,
      neverAnswers,
    ),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "timeout",
  );
  assert.deepEqual(
    await resolvePublicAddressWithin(
      new URL("https://lawfirm.com"),
      100,
      async () => [{ address: "8.8.8.8", family: 4 }],
    ),
    { address: "8.8.8.8", family: 4 },
  );
});

test("robots rules use specific crawler groups, longest match and Allow tie-breaking", () => {
  const policy = parseRobots(
    "User-agent: *\nDisallow: /\n\nUser-agent: PearlLegalGrader\nDisallow: /private\nAllow: /private/public\nDisallow: /fees\nAllow: /fees\nCrawl-delay: 2\n",
  );
  assert.equal(policy.crawlDelaySeconds, 2);
  assert.equal(robotsAllows(policy, new URL("https://lawfirm.com/")), true);
  assert.equal(
    robotsAllows(policy, new URL("https://lawfirm.com/private/secret")),
    false,
  );
  assert.equal(
    robotsAllows(policy, new URL("https://lawfirm.com/private/public/page")),
    true,
  );
  assert.equal(robotsAllows(policy, new URL("https://lawfirm.com/fees")), true);
  const wildcard = parseRobots(
    "User-agent: *\nDisallow: /*.pdf$\nDisallow: /contact*private\nDisallow:\n",
  );
  assert.equal(
    robotsAllows(wildcard, new URL("https://lawfirm.com/a.pdf")),
    false,
  );
  assert.equal(
    robotsAllows(wildcard, new URL("https://lawfirm.com/a.pdf.html")),
    true,
  );
  assert.equal(
    robotsAllows(wildcard, new URL("https://lawfirm.com/contact-us-private")),
    false,
  );
  const unicode = parseRobots(
    "User-agent: *\nDisallow: /café\nDisallow: /~private\n",
  );
  assert.equal(
    robotsAllows(unicode, new URL("https://lawfirm.com/caf%C3%A9")),
    false,
  );
  assert.equal(
    robotsAllows(unicode, new URL("https://lawfirm.com/%7Eprivate")),
    false,
  );
});
