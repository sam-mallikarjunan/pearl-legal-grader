import test from "node:test";
import assert from "node:assert/strict";
import {
  AccountAuthError,
  requireRecentAccountAuthentication,
} from "./account-auth";

const now = Date.parse("2026-10-19T14:00:00.000Z");
const seconds = now / 1000;
const userId = "f18d22a2-38ea-44d7-83ca-3a954fcd7725";
const sessionId = "c4fd5204-6619-465f-894a-2ba37dd7889e";
function claims(amr: unknown = [{ method: "otp", timestamp: seconds - 60 }]) {
  return {
    sub: userId,
    role: "authenticated",
    session_id: sessionId,
    iat: seconds,
    exp: seconds + 3600,
    amr,
  };
}
function verifier(value: unknown, lastSignInAt = new Date(now).toISOString()) {
  const calls: string[] = [];
  return {
    calls,
    auth: {
      async getUser() {
        calls.push("getUser");
        return {
          data: {
            user: {
              id: userId,
              email_confirmed_at: "2026-10-01T00:00:00Z",
              last_sign_in_at: lastSignInAt,
            },
          },
          error: null,
        };
      },
      async getClaims(...args: unknown[]) {
        assert.equal(
          args.length,
          0,
          "verify the SDK's current session, not caller-supplied JWT data",
        );
        calls.push("getClaims");
        return { data: { claims: value }, error: null };
      },
    },
  };
}
const denied =
  (status = 403) =>
  (error: unknown) =>
    error instanceof AccountAuthError && error.status === status;

test("a sign-in on another device and fresh token issuance cannot renew an old session's deletion permission", async () => {
  const oldSession = verifier(
    claims([
      { method: "otp", timestamp: seconds - 3600 },
      { method: "token_refresh", timestamp: seconds },
    ]),
  );
  await assert.rejects(
    requireRecentAccountAuthentication(oldSession.auth, userId, now),
    denied(),
  );
  assert.deepEqual(oldSession.calls.sort(), ["getClaims", "getUser"]);
  const newSession = verifier(
    claims([{ method: "otp", timestamp: seconds - 1 }]),
  );
  await assert.doesNotReject(
    requireRecentAccountAuthentication(newSession.auth, userId, now),
  );
});

test("verified current-session email authentication controls the exact fifteen-minute boundary", async () => {
  for (const method of ["otp", "magiclink"]) {
    const exact = verifier(
      claims([{ method, timestamp: seconds - 900 }]),
      "2025-01-01T00:00:00Z",
    );
    await assert.doesNotReject(
      requireRecentAccountAuthentication(exact.auth, userId, now),
    );
    const expired = verifier(claims([{ method, timestamp: seconds - 901 }]));
    await assert.rejects(
      requireRecentAccountAuthentication(expired.auth, userId, now),
      denied(),
    );
  }
});

test("missing timestamps, noninteractive methods and malformed or future authentication evidence fail closed", async () => {
  for (const amr of [
    undefined,
    null,
    [],
    ["otp"],
    [{ method: "otp" }],
    [{ method: "otp", timestamp: String(seconds) }],
    [{ method: "otp", timestamp: Infinity }],
    [{ method: "otp", timestamp: seconds + 31 }],
    [{ method: "token_refresh", timestamp: seconds }],
    [{ method: "anonymous", timestamp: seconds }],
    [{ method: "email_change", timestamp: seconds }],
  ]) {
    const payload = { ...claims(), amr };
    await assert.rejects(
      requireRecentAccountAuthentication(verifier(payload).auth, userId, now),
      denied(),
    );
  }
});

test("claims must identify the same authenticated user and a concrete session; editable user metadata is ignored", async () => {
  for (const payload of [
    null,
    { ...claims(), sub: "another-user" },
    { ...claims(), role: "service_role" },
    { ...claims(), session_id: undefined },
    { ...claims(), session_id: "not-a-session" },
    {
      ...claims([]),
      user_metadata: {
        amr: [{ method: "otp", timestamp: seconds }],
        last_sign_in_at: new Date(now).toISOString(),
      },
    },
  ])
    await assert.rejects(
      requireRecentAccountAuthentication(verifier(payload).auth, userId, now),
      denied(),
    );
});

test("a live user validation failure still denies access even when verified session authentication is recent", async () => {
  for (const user of [
    null,
    { id: userId },
    { id: "another-user", email_confirmed_at: "2026-10-01T00:00:00Z" },
  ]) {
    const setup = verifier(claims());
    const auth = {
      ...setup.auth,
      getUser: async () => ({ data: { user }, error: null }),
    };
    await assert.rejects(
      requireRecentAccountAuthentication(auth, userId, now),
      denied(401),
    );
  }
  const setup = verifier(claims());
  await assert.rejects(
    requireRecentAccountAuthentication(
      {
        ...setup.auth,
        getUser: async () => ({
          data: { user: null },
          error: new Error("revoked"),
        }),
      },
      userId,
      now,
    ),
    denied(401),
  );
});

test("failed claim verification cannot fall back to a recent account timestamp or expose provider errors", async () => {
  const setup = verifier(claims());
  for (const getClaims of [
    async () => ({
      data: { claims: claims() },
      error: new Error("PRIVATE_PROVIDER_DATA"),
    }),
    async () => ({ data: null, error: null }),
    async () => {
      throw new Error("PRIVATE_PROVIDER_DATA");
    },
  ])
    await assert.rejects(
      requireRecentAccountAuthentication(
        { ...setup.auth, getClaims },
        userId,
        now,
      ),
      (error: unknown) =>
        denied()(error) &&
        error instanceof Error &&
        !error.message.includes("PRIVATE_PROVIDER_DATA"),
    );
});
