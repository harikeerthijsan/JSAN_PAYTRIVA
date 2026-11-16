import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { PaymentStatus, PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createOpaqueToken, hashToken } from "../src/lib/security";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be configured for payment calendar integration tests.");
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

async function createUser(roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const user = await db.user.create({
    data: {
      fullName: `Calendar ${roleKey}`,
      email: `calendar-${roleKey.toLowerCase()}-${suffix}-${userIds.length}@example.test`,
      isActive: true,
      activatedAt: new Date(),
      timeZone: "Asia/Kolkata",
    },
  });
  userIds.push(user.id);
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const token = createOpaqueToken();
  await db.authSession.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3_600_000) } });
  return { user, cookie: `paytriva_session=${token}` };
}

async function api(path: string, cookie: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Cookie: cookie, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  });
}

async function createPendingApproval(approverId: string, requestorId: string, overrides: Record<string, unknown>) {
  const threshold = await db.approvalThreshold.findFirstOrThrow({ where: { isActive: true } });
  const request = await db.paymentRequest.create({
    data: {
      transactionId: `PTR-CAL-${suffix}-${requestIds.length}`,
      requestorId,
      status: PaymentStatus.PENDING_APPROVAL,
      vendorName: "Calendar Vendor",
      invoiceNumber: `INV-${suffix}-${requestIds.length}`,
      finalValueUsd: "3200.00",
      invoiceAmount: "3200.00",
      currencyCode: null,
      ...overrides,
    },
  });
  requestIds.push(request.id);
  await db.approvalAssignment.create({ data: { requestId: request.id, approverId, thresholdId: threshold.id } });
  return request;
}

test("required case: approving a request submitted 04-Nov-2026 schedules the 11-Nov-2026 Wednesday run", async () => {
  const requestor = await createUser("REQUESTOR");
  const approver = await createUser("APPROVER");
  const request = await createPendingApproval(approver.user.id, requestor.user.id, {
    submittedAt: new Date("2026-11-04T09:00:00.000Z"),
    dueDate: new Date("2026-12-31T00:00:00.000Z"),
  });

  const result = await api(`/api/payment-requests/${request.id}/workflow`, approver.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "approve", comment: "Approved." }),
  });
  assert.equal(result.status, 200);

  const schedule = await db.paymentSchedule.findUniqueOrThrow({ where: { requestId: request.id } });
  assert.equal(schedule.earliestEligibleDate?.toISOString().slice(0, 10), "2026-11-11");
  assert.equal(schedule.plannedDate?.toISOString().slice(0, 10), "2026-11-11");
  assert.equal(schedule.riskStatus, "ON_TRACK");
  assert.equal(schedule.autoScheduled, true);

  const history = await db.paymentScheduleHistory.findMany({ where: { requestId: request.id } });
  assert.ok(history.some((entry) => entry.action === "AUTO_SCHEDULED"));
  // Requestor is notified that payment was scheduled; due date itself is untouched.
  assert.equal((await db.paymentRequest.findUniqueOrThrow({ where: { id: request.id } })).dueDate?.toISOString().slice(0, 10), "2026-12-31");
  const notifications = await db.notification.findMany({ where: { requestId: request.id, userId: requestor.user.id } });
  assert.ok(notifications.some((note) => note.title === "Payment scheduled"));
});

test("approval flags at risk when the earliest eligible Wednesday falls after the due date", async () => {
  const requestor = await createUser("REQUESTOR");
  const approver = await createUser("APPROVER");
  const request = await createPendingApproval(approver.user.id, requestor.user.id, {
    submittedAt: new Date("2026-11-04T09:00:00.000Z"),
    dueDate: new Date("2026-11-09T00:00:00.000Z"), // earlier than the 11-Nov eligible Wednesday
  });
  await api(`/api/payment-requests/${request.id}/workflow`, approver.cookie, { method: "POST", body: JSON.stringify({ action: "approve" }) });
  const schedule = await db.paymentSchedule.findUniqueOrThrow({ where: { requestId: request.id } });
  assert.equal(schedule.riskStatus, "AT_RISK");
});

test("calendar access is role-scoped on the backend", async () => {
  const requestorA = await createUser("REQUESTOR");
  const requestorB = await createUser("REQUESTOR");
  const approver = await createUser("APPROVER");
  const ap = await createUser("ACCOUNTS_PAYABLE");
  const request = await createPendingApproval(approver.user.id, requestorA.user.id, {
    submittedAt: new Date("2026-10-01T09:00:00.000Z"),
    dueDate: new Date("2026-12-31T00:00:00.000Z"),
  });
  await api(`/api/payment-requests/${request.id}/workflow`, approver.cookie, { method: "POST", body: JSON.stringify({ action: "approve" }) });

  const contains = async (cookie: string) => {
    const response = await api("/api/payment-calendar", cookie);
    assert.equal(response.status, 200);
    const body = await response.json();
    return (body.entries as { id: string }[]).some((entry) => entry.id === request.id);
  };
  assert.equal(await contains(requestorA.cookie), true, "owner sees their payment");
  assert.equal(await contains(requestorB.cookie), false, "another requestor does not");
  assert.equal(await contains(approver.cookie), true, "assigned approver sees it");
  assert.equal(await contains(ap.cookie), true, "AP sees all payments");
});

test("pending-approval invoices are never shown as overdue", async () => {
  const requestor = await createUser("REQUESTOR");
  const approver = await createUser("APPROVER");
  // A request still awaiting approval, already past its due date.
  const pending = await createPendingApproval(approver.user.id, requestor.user.id, {
    submittedAt: new Date("2026-01-01T09:00:00.000Z"),
    dueDate: new Date("2026-01-15T00:00:00.000Z"),
  });
  const response = await api("/api/payment-calendar", requestor.cookie);
  const body = await response.json();
  const entry = (body.entries as { id: string; category: string }[]).find((item) => item.id === pending.id);
  // Calendar only tracks approved and paid payments, so a pending request never appears as overdue.
  assert.equal(entry, undefined);
});

test("manual reschedule enforces the seven-day minimum and records history", async () => {
  const requestor = await createUser("REQUESTOR");
  const approver = await createUser("APPROVER");
  const ap = await createUser("ACCOUNTS_PAYABLE");
  const request = await createPendingApproval(approver.user.id, requestor.user.id, {
    submittedAt: new Date("2026-11-04T09:00:00.000Z"),
    dueDate: new Date("2026-12-31T00:00:00.000Z"),
  });
  await api(`/api/payment-requests/${request.id}/workflow`, approver.cookie, { method: "POST", body: JSON.stringify({ action: "approve" }) });

  // Before the seven-day minimum (earliest eligible is 2026-11-11) must be rejected.
  const tooEarly = await api(`/api/ap/payments/${request.id}/schedule`, ap.cookie, {
    method: "PATCH",
    body: JSON.stringify({ plannedDate: "2026-11-05" }),
  });
  assert.equal(tooEarly.status, 400);

  // A valid later Wednesday is accepted and recorded.
  const ok = await api(`/api/ap/payments/${request.id}/schedule`, ap.cookie, {
    method: "PATCH",
    body: JSON.stringify({ plannedDate: "2026-11-18", remarks: "Vendor requested later run." }),
  });
  assert.equal(ok.status, 200);
  const schedule = await db.paymentSchedule.findUniqueOrThrow({ where: { requestId: request.id } });
  assert.equal(schedule.plannedDate?.toISOString().slice(0, 10), "2026-11-18");
  assert.equal(schedule.autoScheduled, false);
  const history = await db.paymentScheduleHistory.findMany({ where: { requestId: request.id, action: "RESCHEDULED" } });
  assert.ok(history.length >= 1);
});

test("financial summary totals approved outstanding value in USD", async () => {
  const ap = await createUser("ACCOUNTS_PAYABLE");
  const response = await api("/api/payment-calendar/summary", ap.cookie);
  assert.equal(response.status, 200);
  const summary = await response.json();
  assert.equal(summary.reportingCurrency, "USD");
  // The approved requests created above contribute to the AP-wide outstanding total.
  assert.ok(Number(summary.totals.outstandingApprovedUsd) >= 3200);
  assert.ok(Array.isArray(summary.byProject));
  assert.ok(Array.isArray(summary.byVendor));
});
