import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isSameOriginRequest, newScanToken, readScanToken, tokenDigest, isOperator, scanClientHash } from "./scan-security";

test("capabilities are random, fixed length, and accepted only in an Authorization header", () => {
  const first = newScanToken(); const second = newScanToken();
  assert.equal(first.length, 43); assert.notEqual(first, second);
  assert.equal(readScanToken(new Request("https://grader.example/api/scans/one?token=" + first)), null);
  assert.equal(readScanToken(new Request("https://grader.example/api/scans/one", {headers:{authorization:"Bearer " + first}})), first);
  assert.equal(tokenDigest(first).length, 64); assert.notEqual(tokenDigest(first), first);
  assert.equal(readScanToken(new Request("https://grader.example", {headers:{authorization:"Bearer short"}})), null);
});
test("scan submissions reject a different browser origin", () => {
  assert.equal(isSameOriginRequest(new Request("https://grader.example/api/scans", {headers:{origin:"https://other.example"}})), false);
  assert.equal(isSameOriginRequest(new Request("https://grader.example/api/scans", {headers:{origin:"https://grader.example"}})), true);
  assert.equal(isSameOriginRequest(new Request("https://grader.example/api/scans", {headers:{"sec-fetch-site":"cross-site"}})), false);
});
test("operator endpoints fail closed without a configured operator secret", () => {
  const old = process.env.SCAN_OPERATOR_SECRET; delete process.env.SCAN_OPERATOR_SECRET;
  assert.equal(isOperator(new Request("https://grader.example", {headers:{authorization:"Bearer random"}})), false);
  if (old !== undefined) process.env.SCAN_OPERATOR_SECRET=old;
});
test("client quota identity stores a keyed digest rather than a raw address", () => {
  const oldSecret=process.env.SCAN_HASH_SECRET; const oldVercel=process.env.VERCEL;
  process.env.SCAN_HASH_SECRET="test-secret-012345678901234567890123456"; process.env.VERCEL="1";
  const request=new Request("https://grader.example",{headers:{"x-vercel-forwarded-for":"203.0.113.7"}});
  assert.equal(scanClientHash(request).length,64); assert.ok(!scanClientHash(request).includes("203.0.113.7"));
  if(oldSecret===undefined)delete process.env.SCAN_HASH_SECRET;else process.env.SCAN_HASH_SECRET=oldSecret;
  if(oldVercel===undefined)delete process.env.VERCEL;else process.env.VERCEL=oldVercel;
});
