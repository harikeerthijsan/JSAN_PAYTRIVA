import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient, type Role } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be configured for integration tests.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const password = "Audit!Integration2026";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: string[] = [];
const auditIds: string[] = [];

after(async () => {
  if (userIds.length) {
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { entityId: { in: userIds } },
          { id: { in: auditIds } },
        ],
      },
    });
    await db.accountToken.deleteMany({ where: { userId: { in: userIds } } });
    await db.invitation.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { invitedById: { in: userIds } }] },
    });
    await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  } else if (auditIds.length) {
    await db.auditLog.deleteMany({ where: { id: { in: auditIds } } });
  }
  await db.$disconnect();
});

async function createEmployee(role: Role, name: string, permissions: string[] = []) {
  const user = await db.user.create({
    data: {
      fullName: name,
      email: `${role.key.toLowerCase()}-${suffix}-${userIds.length}@example.test`,
      passwordHash: await bcrypt.hash(password, 10),
      activatedAt: new Date(),
      isActive: true,
    },
  });
  userIds.push(user.id);
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  if (permissions.length) {
    const records = await db.permission.findMany({ where: { key: { in: permissions } } });
    await db.userPermission.createMany({
      data: records.map(({ id }) => ({ userId: user.id, permissionId: id })),
    });
  }
  return user;
}

async function signIn(email: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const match = (response.headers.get("set-cookie") ?? "").match(/paytriva_session=([^;]+)/);
  assert.equal(response.status, 200);
  assert.ok(match);
  return `paytriva_session=${match[1]}`;
}

test("audit history is paginated and restricted to platform administrators", async () => {
  const [apRole, requestorRole] = await Promise.all([
    db.role.findUniqueOrThrow({ where: { key: "ACCOUNTS_PAYABLE" } }),
    db.role.findUniqueOrThrow({ where: { key: "REQUESTOR" } }),
  ]);
  const admin = await createEmployee(apRole, "Audit Test Administrator", ["platform:admin", "users:invite", "users:assign_role"]);
  const requestor = await createEmployee(requestorRole, "Audit Test Requestor");
  const records = await db.auditLog.createManyAndReturn({
    data: [
      {
        actorId: admin.id,
        actorName: admin.fullName,
        action: "AUDIT_TEST_CREATED",
        entityType: "TEST",
        entityId: suffix,
        summary: "First audit pagination fixture.",
        newValue: { status: "FIRST" },
      },
      {
        actorId: admin.id,
        actorName: admin.fullName,
        action: "AUDIT_TEST_UPDATED",
        entityType: "TEST",
        entityId: suffix,
        summary: "Second audit pagination fixture.",
        newValue: { status: "SECOND" },
      },
    ],
    select: { id: true },
  });
  auditIds.push(...records.map(({ id }) => id));

  const adminCookie = await signIn(admin.email);
  const requestorCookie = await signIn(requestor.email);
  const denied = await fetch(`${baseUrl}/api/admin/audit`, { headers: { Cookie: requestorCookie } });
  assert.equal(denied.status, 403);

  const response = await fetch(`${baseUrl}/api/admin/audit?search=${suffix}&pageSize=1`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(response.status, 200);
  const result = await response.json() as { entries: { action: string }[]; total: number; page: number; pageSize: number };
  assert.equal(result.total, 2);
  assert.equal(result.entries.length, 1);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 1);
  assert.equal(result.entries[0].action, "AUDIT_TEST_UPDATED");

  const invalidDate = await fetch(`${baseUrl}/api/admin/audit?from=not-a-date`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(invalidDate.status, 400);

  const createdEmail = `audit-create-${suffix}@example.test`;
  const createResponse = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: { Cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: "Audit Lifecycle Employee", email: createdEmail, roleKey: "REQUESTOR", password: "Create!AuditPassword2026" }),
  });
  assert.equal(createResponse.status, 201);
  const createdUser = await db.user.findUniqueOrThrow({ where: { email: createdEmail } });
  userIds.push(createdUser.id);
  assert.equal(createdUser.isActive, true, "a created employee is active immediately");

  const recoveryResponse = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: createdEmail }),
  });
  assert.equal(recoveryResponse.status, 200);
  const recovery = await recoveryResponse.json() as { developmentUrl?: string };
  assert.ok(recovery.developmentUrl, "development password reset should expose its URL");
  const resetToken = new URLSearchParams(new URL(recovery.developmentUrl).hash.slice(1)).get("token");
  assert.ok(resetToken);
  const resetResponse = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: resetToken, password: "Changed!AuditPassword2026" }),
  });
  assert.equal(resetResponse.status, 200);

  const lifecycleEntries = await db.auditLog.findMany({
    where: { entityId: createdUser.id, action: { in: ["USER_CREATED", "PASSWORD_RESET"] } },
    select: { action: true, actorId: true, newValue: true },
  });
  assert.deepEqual(new Set(lifecycleEntries.map(({ action }) => action)), new Set(["USER_CREATED", "PASSWORD_RESET"]));
  assert.equal(lifecycleEntries.find(({ action }) => action === "USER_CREATED")?.actorId, admin.id);
  assert.equal(lifecycleEntries.find(({ action }) => action === "PASSWORD_RESET")?.actorId, createdUser.id);
  assert.ok(lifecycleEntries.every(({ newValue }) => !JSON.stringify(newValue).includes(resetToken!)));
});
