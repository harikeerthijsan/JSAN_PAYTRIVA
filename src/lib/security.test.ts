import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpaqueToken, createThrottleKey, hashToken } from "./security";

test("opaque tokens are high entropy URL-safe values", () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("token hashes are stable and do not contain the raw token", () => {
  const token = createOpaqueToken();
  const hash = hashToken(token);
  assert.equal(hash, hashToken(token));
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
});

test("login throttle keys are deterministic without exposing the email", () => {
  const key = createThrottleKey("Employee@jsan.test", "account");
  assert.equal(key, createThrottleKey("employee@jsan.test", "account"));
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.ok(!key.includes("jsan.test"));
});
