import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { inviteSchema, passwordMeetsPolicy, profileSchema } from "./validation";

const originalDomain = process.env.ALLOWED_EMAIL_DOMAIN;

afterEach(() => {
  if (originalDomain === undefined) delete process.env.ALLOWED_EMAIL_DOMAIN;
  else process.env.ALLOWED_EMAIL_DOMAIN = originalDomain;
});

test("invitation emails are normalized and validated", () => {
  delete process.env.ALLOWED_EMAIL_DOMAIN;
  const result = inviteSchema.safeParse({
    fullName: "  Jamie Employee  ",
    email: "JAMIE@Example.Test",
    roleKey: "REQUESTOR",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.fullName, "Jamie Employee");
    assert.equal(result.data.email, "jamie@example.test");
  }
});

test("configured employee email domain is enforced", () => {
  process.env.ALLOWED_EMAIL_DOMAIN = "jsanconsulting.com";
  assert.equal(inviteSchema.safeParse({
    fullName: "Jamie Employee",
    email: "jamie@jsanconsulting.com",
    roleKey: "REQUESTOR",
  }).success, true);
  assert.equal(inviteSchema.safeParse({
    fullName: "Jamie Employee",
    email: "jamie@other.test",
    roleKey: "REQUESTOR",
  }).success, false);
});

test("password policy requires length and character variety", () => {
  assert.equal(passwordMeetsPolicy("FinancialControl2026!"), true);
  assert.equal(passwordMeetsPolicy("short!"), false);
  assert.equal(passwordMeetsPolicy("alllowercase2026!"), false);
  assert.equal(passwordMeetsPolicy("NoNumberOrSymbol"), false);
  assert.equal(passwordMeetsPolicy(`${"A".repeat(71)}1!`), false);
  assert.equal(passwordMeetsPolicy(`${"🔒".repeat(18)}aA1!`), false);
});

test("profile accepts valid IANA time zones and rejects invalid values", () => {
  const valid = profileSchema.safeParse({ fullName: "Jamie Employee", timeZone: "America/Los_Angeles" });
  assert.equal(valid.success, true);
  assert.equal(profileSchema.safeParse({ fullName: "Jamie Employee", timeZone: "Mars/Olympus" }).success, false);
});
