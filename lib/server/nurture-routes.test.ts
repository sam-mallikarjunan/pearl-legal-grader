import { strict as assert } from "node:assert";
import { test } from "node:test";
import { GET, POST } from "../../app/api/nurture/unsubscribe/route";
import { GET as cron } from "../../app/api/cron/nurture/route";
import { POST as dispatch } from "../../app/api/admin/nurture/dispatch/route";

test("unsubscribe GET only renders a confirmation route, never mutates preferences", async () => {
  const response = await GET(
    new Request(
      "https://example.invalid/api/nurture/unsubscribe?token=synthetic",
    ),
  );
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "https://example.invalid/nurture/unsubscribe?token=synthetic",
  );
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("cache-control") || "", /no-store/);
});
test("one-click unsubscribe validates RFC8058 form content and bounds streamed bytes", async () => {
  for (const request of [
    new Request("https://example.invalid/api/nurture/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    new Request("https://example.invalid/api/nurture/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=Wrong",
    }),
    new Request("https://example.invalid/api/nurture/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click&List-Unsubscribe=One-Click",
    }),
  ])
    assert.equal((await POST(request)).status, 400);
  const response = await POST(
    new Request("https://example.invalid/api/nurture/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "x".repeat(513),
    }),
  );
  assert.equal(response.status, 413);
});
test("unauthorized cron calls cannot reserve or dispatch due lessons", async () => {
  const response = await cron(
    new Request("https://example.invalid/api/cron/nurture"),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found." });
});
test("operator dispatch rejects cross-site writes before auth or queue access", async () => {
  const response = await dispatch(
    new Request("https://example.invalid/api/admin/nurture/dispatch", {
      method: "POST",
      headers: {
        origin: "https://other.invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirm: "DISPATCH DUE LESSONS" }),
    }),
  );
  assert.equal(response.status, 403);
});
