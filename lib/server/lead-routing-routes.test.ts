import { strict as assert } from "node:assert";
import { test } from "node:test";
import { GET } from "../../app/api/admin/routing/route";
import { POST } from "../../app/api/admin/routing/[id]/contact/route";
const base = "https://grader.example/api/admin/routing";
test("private queue requires authenticated operator and no-store", async () => {
  const original = process.env.ACCOUNTS_ENABLED;
  process.env.ACCOUNTS_ENABLED = "false";
  try {
    const response = await GET(new Request(base));
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    if (original === undefined) delete process.env.ACCOUNTS_ENABLED;
    else process.env.ACCOUNTS_ENABLED = original;
  }
});
test("contact disclosure rejects cross-site access before any user data is read", async () => {
  const response = await POST(
    new Request(base + "/00000000-0000-4000-8000-000000000003/contact", {
      method: "POST",
      headers: {
        origin: "https://untrusted.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirm: "VIEW REQUESTED CONTACT", revision: 0 }),
    }),
    { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000003" }) },
  );
  assert.equal(response.status, 403);
});
