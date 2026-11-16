import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";

const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";

test("health endpoint reports service and database status without authentication", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json() as { status: string; checks: { database: boolean } };
  assert.equal(body.status, "ok");
  assert.equal(body.checks.database, true);
});

test("responses carry baseline security headers", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.ok(response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
  assert.ok(response.headers.get("referrer-policy"));
});
