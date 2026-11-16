import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { PrismaClient, PaymentStatus } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createOpaqueToken, hashToken } from "../src/lib/security";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be configured for notification integration tests.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: string[] = [];
const requestIds: string[] = [];

after(async () => {
  if (requestIds.length) await db.paymentRequest.deleteMany({ where: { id: { in: requestIds } } });
  if (userIds.length) {
    await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await db.$disconnect();
});

async function createUser(roleKey: string, permissions: string[] = []) {
  const [role, user] = await Promise.all([
    db.role.findUniqueOrThrow({ where: { key: roleKey } }),
    db.user.create({
      data: {
        fullName: `Notification Test ${roleKey}`,
        email: `notification-${roleKey.toLowerCase()}-${suffix}-${userIds.length}@example.test`,
        isActive: true,
        activatedAt: new Date(),
        timeZone: "Asia/Kolkata",
      },
    }),
  ]);
  userIds.push(user.id);
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  if (permissions.length) {
    const records = await db.permission.findMany({ where: { key: { in: permissions } } });
    assert.equal(records.length, permissions.length);
    await db.userPermission.createMany({ data: records.map(({ id }) => ({ userId: user.id, permissionId: id })) });
  }
  const token = createOpaqueToken();
  await db.authSession.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  return { user, cookie: `paytriva_session=${token}` };
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

test("notification history is user-scoped and admin configuration is permission-protected", async () => {
  const requestor = await createUser("REQUESTOR");
  const otherRequestor = await createUser("REQUESTOR");
  const admin = await createUser("ACCOUNTS_PAYABLE", ["platform:admin"]);
  const request = await db.paymentRequest.create({
    data: { transactionId: `PTR-NOTIFY-${suffix}`, requestorId: requestor.user.id, status: PaymentStatus.PENDING_REVIEW },
  });
  requestIds.push(request.id);
  const notification = await db.notification.create({
    data: {
      userId: requestor.user.id,
      requestId: request.id,
      eventKey: `integration:${suffix}:requestor`,
      category: "request_submitted",
      templateKey: "request_submitted",
      title: "Payment request submitted",
      message: `Transaction: ${request.transactionId}`,
      href: `/payment-requests/${request.id}`,
    },
  });

  const ownHistory = await api("/api/notifications?type=request_submitted", requestor.cookie).then((response) => response.json());
  const otherHistory = await api("/api/notifications?type=request_submitted", otherRequestor.cookie).then((response) => response.json());
  assert.equal(ownHistory.timeZone, "Asia/Kolkata");
  assert.equal(ownHistory.items.some((item: { id: string }) => item.id === notification.id), true);
  assert.equal(otherHistory.items.some((item: { id: string }) => item.id === notification.id), false);
  assert.equal((await api("/api/admin/notifications", requestor.cookie)).status, 403);

  assert.equal((await api("/api/notifications", otherRequestor.cookie, {
    method: "PATCH",
    body: JSON.stringify({ id: notification.id }),
  })).status, 200);
  assert.equal((await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt, null);
  assert.equal((await api("/api/notifications", requestor.cookie, {
    method: "PATCH",
    body: JSON.stringify({ id: notification.id }),
  })).status, 200);
  assert.ok((await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt);

  const settingsResponse = await api("/api/admin/notifications", admin.cookie);
  assert.equal(settingsResponse.status, 200);
  const settings = await settingsResponse.json();
  assert.equal(settings.templates.length, 8);
  assert.equal(Object.hasOwn(settings.settings, "smtpPasswordCipher"), false);
  assert.equal(settings.settings.reminderHours.join(","), "8,24,48");
});

test("approval resolution retains notification history and cancels pending reminders", async () => {
  const requestor = await createUser("REQUESTOR");
  const approver = await createUser("APPROVER", ["approvals:access"]);
  const threshold = await db.approvalThreshold.findFirstOrThrow({ where: { isActive: true } });
  const request = await db.paymentRequest.create({
    data: {
      transactionId: `PTR-APPROVAL-${suffix}`,
      requestorId: requestor.user.id,
      status: PaymentStatus.PENDING_APPROVAL,
      vendorName: "Notification Test Vendor",
      invoiceNumber: `INV-${suffix}`,
      finalValueUsd: "1250.00",
    },
  });
  requestIds.push(request.id);
  const assignment = await db.approvalAssignment.create({
    data: { requestId: request.id, approverId: approver.user.id, thresholdId: threshold.id },
  });
  await db.reminderSchedule.create({
    data: {
      assignmentId: assignment.id,
      nextReminderAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      nextStage: 1,
    },
  });

  const result = await api(`/api/payment-requests/${request.id}/workflow`, approver.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "approve", comment: "Validated." }),
  });
  assert.equal(result.status, 200);
  assert.ok((await db.reminderSchedule.findUniqueOrThrow({ where: { assignmentId: assignment.id } })).canceledAt);
  const requestorNotifications = await db.notification.findMany({
    where: { requestId: request.id, userId: requestor.user.id, category: "approval_decision" },
  });
  assert.equal(requestorNotifications.some((item) => item.title === "Payment request approved"), true);
  assert.equal(requestorNotifications.some((item) => item.message.includes("Notification Test Vendor")), true);
  assert.equal((await api(`/api/payment-requests/${request.id}/workflow`, approver.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "approve" }),
  })).status, 403);
});
