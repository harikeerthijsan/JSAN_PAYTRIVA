import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient, type Role } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createOpaqueToken, hashToken } from "../src/lib/security";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be configured for integration tests.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const password = "Employee!Secure2026";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const testUserIds: string[] = [];

after(async () => {
  if (testUserIds.length) {
    await db.invitation.deleteMany({
      where: {
        OR: [
          { invitedById: { in: testUserIds } },
          { userId: { in: testUserIds } },
        ],
      },
    });
    await db.user.deleteMany({ where: { id: { in: testUserIds } } });
  }
  await db.$disconnect();
});

async function createEmployee(role: Role, name: string, permissions: string[] = []) {
  const user = await db.user.create({
    data: {
      fullName: name,
      email: `${role.key.toLowerCase()}-${suffix}-${testUserIds.length}@example.test`,
      passwordHash: await bcrypt.hash(password, 10),
      activatedAt: new Date(),
      isActive: true,
    },
  });
  testUserIds.push(user.id);
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  if (permissions.length) {
    const records = await db.permission.findMany({ where: { key: { in: permissions } } });
    await db.userPermission.createMany({
      data: records.map(({ id }) => ({ userId: user.id, permissionId: id })),
    });
  }
  return user;
}

async function signIn(email: string, passwordValue = password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: passwordValue }),
  });
  const rawCookie = response.headers.get("set-cookie") ?? "";
  const match = rawCookie.match(/paytriva_session=([^;]+)/);
  assert.equal(response.status, 200, `sign-in failed for ${email}`);
  assert.ok(match, "session cookie should be set");
  return { cookie: `paytriva_session=${match[1]}`, response };
}

async function api(path: string, cookie: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Cookie: cookie,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

test("auth, invitation lifecycle, and role permissions persist in PostgreSQL", async () => {
  const [requestorRole, apRole, approverRole] = await Promise.all([
    db.role.findUniqueOrThrow({ where: { key: "REQUESTOR" } }),
    db.role.findUniqueOrThrow({ where: { key: "ACCOUNTS_PAYABLE" } }),
    db.role.findUniqueOrThrow({ where: { key: "APPROVER" } }),
  ]);
  const requestor = await createEmployee(requestorRole, "Test Requestor");
  const ap = await createEmployee(apRole, "Test AP Administrator");
  const approver = await createEmployee(approverRole, "Test Approver");
  const platformAdmin = await createEmployee(apRole, "Test Platform Administrator", ["platform:admin"]);

  const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: requestor.email, password: "wrong-password" }),
  });
  assert.equal(invalidLogin.status, 401);

  const requestorSession = await signIn(requestor.email);
  assert.equal((await api("/api/auth/session", requestorSession.cookie)).status, 200);
  assert.equal((await api("/api/users", requestorSession.cookie)).status, 403);
  assert.equal((await api("/api/admin/audit", requestorSession.cookie)).status, 403);
  const expiredSessionToken = createOpaqueToken();
  await db.authSession.create({
    data: {
      userId: requestor.id,
      tokenHash: hashToken(expiredSessionToken),
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  assert.equal((await api("/api/auth/session", `paytriva_session=${expiredSessionToken}`)).status, 401);
  assert.equal(
    (await fetch(`${baseUrl}/workspace/payables`, {
      headers: { Cookie: requestorSession.cookie },
      redirect: "manual",
    })).status,
    307,
  );
  const logout = await api("/api/auth/logout", requestorSession.cookie, { method: "POST" });
  assert.equal(logout.status, 200);
  assert.equal((await api("/api/auth/session", requestorSession.cookie)).status, 401);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failedAttempt = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: requestor.email, password: "wrong-password" }),
    });
    assert.equal(failedAttempt.status, 401);
  }
  const throttledLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: requestor.email, password: "wrong-password" }),
  });
  assert.equal(throttledLogin.status, 429);
  const validDuringThrottle = await signIn(requestor.email);
  assert.equal(validDuringThrottle.response.status, 200);

  const apSession = await signIn(ap.email);
  assert.equal((await api("/api/users", apSession.cookie)).status, 200);
  assert.equal((await fetch(`${baseUrl}/workspace/payables`, { headers: { Cookie: apSession.cookie } })).status, 200);
  assert.equal((await api("/api/admin/audit", apSession.cookie)).status, 403);
  assert.equal(
    (await api(`/api/users/${ap.id}/role`, apSession.cookie, {
      method: "PATCH",
      body: JSON.stringify({ roleKey: "REQUESTOR" }),
    })).status,
    400,
  );
  assert.equal(
    (await api(`/api/users/${platformAdmin.id}/role`, apSession.cookie, {
      method: "PATCH",
      body: JSON.stringify({ roleKey: "REQUESTOR" }),
    })).status,
    403,
  );
  assert.equal(
    (await api(`/api/users/${platformAdmin.id}/status`, apSession.cookie, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    })).status,
    403,
  );
  assert.equal(
    (await api(`/api/users/${requestor.id}/role`, apSession.cookie, {
      method: "PATCH",
      body: JSON.stringify({ roleKey: "APPROVER" }),
    })).status,
    200,
  );
  await db.userRole.deleteMany({ where: { userId: requestor.id } });
  await db.userRole.create({ data: { userId: requestor.id, roleId: requestorRole.id } });

  const approverSession = await signIn(approver.email);
  assert.equal((await api("/api/users", approverSession.cookie)).status, 403);
  assert.equal((await api("/workspace/approvals", approverSession.cookie)).status, 200);
  assert.equal(
    (await fetch(`${baseUrl}/workspace/payables`, {
      headers: { Cookie: approverSession.cookie },
      redirect: "manual",
    })).status,
    307,
  );

  const adminSession = await signIn(platformAdmin.email);
  assert.equal((await api("/api/admin/audit", adminSession.cookie)).status, 200);
  assert.equal(
    (await api(`/api/admin/users/${ap.id}/permissions`, adminSession.cookie, {
      method: "PATCH",
      body: JSON.stringify({ permissions: ["platform:admin"] }),
    })).status,
    200,
  );
  assert.equal((await api("/api/admin/audit", apSession.cookie)).status, 200);
  assert.equal(
    (await api(`/api/admin/users/${ap.id}/permissions`, adminSession.cookie, {
      method: "PATCH",
      body: JSON.stringify({ permissions: [] }),
    })).status,
    200,
  );
  assert.equal((await api("/api/admin/audit", apSession.cookie)).status, 403);
  assert.equal(
    (await api(`/api/admin/users/${platformAdmin.id}/permissions`, adminSession.cookie, {
      method: "PATCH",
      body: JSON.stringify({ permissions: [] }),
    })).status,
    400,
  );

  const newEmail = `new-employee-${suffix}@example.test`;
  const createPassword = "Created!Employee2026";
  const createResponse = await api("/api/users", apSession.cookie, {
    method: "POST",
    body: JSON.stringify({ fullName: "New Employee", email: newEmail, roleKey: "REQUESTOR", password: createPassword }),
  });
  assert.equal(createResponse.status, 201);
  const created = await db.user.findUniqueOrThrow({ where: { email: newEmail } });
  testUserIds.push(created.id);
  assert.equal(created.fullName, "New Employee");
  assert.equal(created.isActive, true);
  // A created employee can sign in immediately with the admin-set password.
  const createdSession = await signIn(newEmail, createPassword);
  assert.equal((await api("/api/auth/session", createdSession.cookie)).status, 200);

  const forgot = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: newEmail }),
  });
  assert.equal(forgot.status, 200);
  const recovery = await forgot.json();
  const resetToken = new URLSearchParams(new URL(recovery.developmentUrl).hash.slice(1)).get("token");
  assert.ok(resetToken);
  const resetPassword = "Reset!Employee2026";
  const reset = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: resetToken, password: resetPassword }),
  });
  assert.equal(reset.status, 200);
  assert.equal((await api("/api/auth/session", createdSession.cookie)).status, 401);
  const reusedReset = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: resetToken, password: resetPassword }),
  });
  assert.equal(reusedReset.status, 400);
  const resetSession = await signIn(newEmail, resetPassword);
  assert.equal((await api("/api/auth/session", resetSession.cookie)).status, 200);
  const profileUpdate = await api("/api/users/me", resetSession.cookie, {
    method: "PATCH",
    body: JSON.stringify({ fullName: "Updated Employee Name", timeZone: "UTC" }),
  });
  assert.equal(profileUpdate.status, 200);
  const updatedProfile = await profileUpdate.json();
  assert.equal(updatedProfile.user.fullName, "Updated Employee Name");
  assert.equal(updatedProfile.user.timeZone, "UTC");

  const requestorAgain = await signIn(requestor.email);
  const deactivation = await api(`/api/users/${requestor.id}/status`, apSession.cookie, {
    method: "PATCH",
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(deactivation.status, 200);
  assert.equal((await api("/api/auth/session", requestorAgain.cookie)).status, 401);

  const expiredUser = await db.user.create({
    data: {
      fullName: "Expired Link Employee",
      email: `expired-${suffix}@example.test`,
      isActive: false,
    },
  });
  testUserIds.push(expiredUser.id);
  assert.equal(
    (await api(`/api/users/${expiredUser.id}/status`, apSession.cookie, {
      method: "PATCH",
      body: JSON.stringify({ isActive: true }),
    })).status,
    400,
  );
  const expiresAt = new Date(Date.now() - 60_000);
  const expiredInvitation = await db.invitation.create({
    data: {
      userId: expiredUser.id,
      invitedById: ap.id,
      roleId: requestorRole.id,
      expiresAt,
    },
  });
  const expiredToken = createOpaqueToken();
  await db.accountToken.create({
    data: {
      userId: expiredUser.id,
      invitationId: expiredInvitation.id,
      purpose: "ACTIVATION",
      tokenHash: hashToken(expiredToken),
      expiresAt,
    },
  });
  const expiredActivation = await fetch(`${baseUrl}/api/auth/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: expiredToken, password: "Expired!Employee2026" }),
  });
  assert.equal(expiredActivation.status, 400);
});
