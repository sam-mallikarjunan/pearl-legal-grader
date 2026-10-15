import { strict as assert } from "node:assert";
import { test } from "node:test";
import { POST } from "../../app/api/scans/route";
import { GET } from "../../app/api/scans/[id]/route";
import { POST as warm } from "../../app/api/internal/scans/warm/route";
import { GET as cleanup } from "../../app/api/internal/scans/cleanup/route";

test("untrusted scan requests fail before any storage, workflow or paid worker call", async () => {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SCAN_HASH_SECRET",
    "SCAN_OPERATOR_SECRET",
    "SCANS_ENABLED",
  ] as const;
  const saved = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    SUPABASE_URL: "https://unit.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_" + "s".repeat(40),
    SCAN_HASH_SECRET: "h".repeat(40),
    SCAN_OPERATOR_SECRET: "o".repeat(40),
    SCANS_ENABLED: "true",
  });
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls++;
    throw new Error("Unexpected external call");
  };
  const request = (body: string, origin = "https://grader.test") =>
    new Request("https://grader.test/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body,
    });
  try {
    assert.equal(
      (
        await POST(
          request(
            JSON.stringify({ url: "https://firm.test" }),
            "https://other.test",
          ),
        )
      ).status,
      403,
    );
    for (const body of [
      "{",
      JSON.stringify({ url: 123 }),
      JSON.stringify({ url: "https://127.0.0.1/" }),
      JSON.stringify({ url: "http://169.254.169.254/" }),
      JSON.stringify({ url: "ftp://public.org/" }),
      JSON.stringify({ url: "https://public.org:8080/" }),
      JSON.stringify({ url: "https://public.org/?token=private" }),
      "x".repeat(4097),
    ]) {
      const response = await POST(request(body));
      assert.equal(response.status, 400, body.slice(0, 80));
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    const context = {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    };
    assert.equal(
      (
        await GET(
          new Request(
            "https://grader.test/api/scans/id?token=" + "t".repeat(43),
          ),
          context,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await warm(
          new Request("https://grader.test/api/internal/scans/warm", {
            method: "POST",
          }),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await cleanup(
          new Request("https://grader.test/api/internal/scans/cleanup"),
        )
      ).status,
      404,
    );
    process.env.SCANS_ENABLED = "false";
    assert.equal(
      (await POST(request(JSON.stringify({ url: "https://public.org/" }))))
        .status,
      503,
    );
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});
