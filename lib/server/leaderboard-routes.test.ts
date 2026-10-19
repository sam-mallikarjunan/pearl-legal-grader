import { strict as assert } from "node:assert";
import { test } from "node:test";
import { GET, POST, DELETE } from "../../app/api/account/leaderboard/route";
const endpoint = "https://grader.example/api/account/leaderboard";
test("anonymous account leaderboard reads require authentication", async () => {
  const original = process.env.ACCOUNTS_ENABLED;
  process.env.ACCOUNTS_ENABLED = "false";
  try {
    const response = await GET(new Request(endpoint));
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    if (original === undefined) delete process.env.ACCOUNTS_ENABLED;
    else process.env.ACCOUNTS_ENABLED = original;
  }
});
test("publication and withdrawal reject missing origins and cross-site requests before persistence", async () => {
  for (const handler of [POST, DELETE])
    for (const headers of [
      { "content-type": "application/json" },
      { "content-type": "application/json", origin: "https://evil.example" },
      {
        "content-type": "application/json",
        origin: "https://grader.example",
        "sec-fetch-site": "cross-site",
      },
    ]) {
      const response = await handler(
        new Request(endpoint, {
          method: handler === POST ? "POST" : "DELETE",
          headers: headers as Record<string, string>,
          body: JSON.stringify({ revision: 0, consent: true }),
        }),
      );
      assert.equal(response.status, 403);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    }
});
