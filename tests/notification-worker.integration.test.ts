import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NotificationDeliveryStatus, PaymentStatus, PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { deliverPendingNotifications, scheduleApprovalReminders, schedulePaymentDueNotifications } from "../src/lib/notification-worker";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be configured for notification worker integration tests.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: string[] = [];
const requestIds: string[] = [];
const notificationIds: string[] = [];

after(async () => {
  if (notificationIds.length) await db.notification.deleteMany({ where: { id: { in: notificationIds } } });
  if (requestIds.length) await db.paymentRequest.deleteMany({ where: { id: { in: requestIds } } });
  if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

async function createUser(roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const user = await db.user.create({
    data: {
      fullName: `Worker Test ${roleKey}`,
      email: `worker-${roleKey.toLowerCase()}-${suffix}-${userIds.length}@example.test`,
      isActive: true,
      activatedAt: new Date(),
      timeZone: "Asia/Kolkata",
    },
  });
  userIds.push(user.id);
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function createPendingApproval(assignedAt: Date) {
  const [requestor, approver, threshold] = await Promise.all([
    createUser("REQUESTOR"),
    createUser("APPROVER"),
    db.approvalThreshold.findFirstOrThrow({ where: { isActive: true } }),
  ]);
  const request = await db.paymentRequest.create({
    data: {
      transactionId: `PTR-WORKER-${suffix}-${requestIds.length}`,
      requestorId: requestor.id,
      status: PaymentStatus.PENDING_APPROVAL,
      vendorName: "Worker Test Vendor",
      invoiceNumber: `INV-${suffix}-${requestIds.length}`,
      finalValueUsd: "1250.00",
    },
  });
  requestIds.push(request.id);
  const assignment = await db.approvalAssignment.create({
    data: { requestId: request.id, approverId: approver.id, thresholdId: threshold.id, assignedAt },
  });
  return { requestor, approver, request, assignment };
}

function effectiveReminderHours(value: unknown): number[] {
  if (Array.isArray(value) && value.length === 3 && value.every((hour) => Number.isInteger(hour) && hour >= 1)) {
    return value as number[];
  }
  return [8, 24, 48];
}

test("approval reminders fire once per 8/24/48 stage and stop after the final stage", async () => {
  const base = new Date("2026-01-01T00:00:00.000Z");
  const settings = await db.notificationSettings.findUnique({ where: { id: "default" } });
  const hours = effectiveReminderHours(settings?.reminderHours);
  const { approver, request, assignment } = await createPendingApproval(base);
  await db.reminderSchedule.create({
    data: {
      assignmentId: assignment.id,
      nextStage: 1,
      nextReminderAt: new Date(base.getTime() + hours[0] * 3_600_000),
    },
  });

  async function reminderCount(hour: number) {
    return db.notification.count({
      where: { userId: approver.id, requestId: request.id, eventKey: `approval:${assignment.id}:reminder:${hour}h` },
    });
  }

  // Stage 1 at 8h.
  await scheduleApprovalReminders(new Date(base.getTime() + hours[0] * 3_600_000));
  assert.equal(await reminderCount(hours[0]), 1);
  let schedule = await db.reminderSchedule.findUniqueOrThrow({ where: { assignmentId: assignment.id } });
  assert.equal(schedule.nextStage, 2);
  assert.equal(schedule.nextReminderAt?.getTime(), base.getTime() + hours[1] * 3_600_000);

  // Running again at the same instant must not duplicate the 8h reminder.
  await scheduleApprovalReminders(new Date(base.getTime() + hours[0] * 3_600_000));
  assert.equal(await reminderCount(hours[0]), 1);

  // Stage 2 at 24h.
  await scheduleApprovalReminders(new Date(base.getTime() + hours[1] * 3_600_000));
  assert.equal(await reminderCount(hours[1]), 1);
  schedule = await db.reminderSchedule.findUniqueOrThrow({ where: { assignmentId: assignment.id } });
  assert.equal(schedule.nextStage, 3);
  assert.equal(schedule.nextReminderAt?.getTime(), base.getTime() + hours[2] * 3_600_000);

  // Stage 3 at 48h — final stage clears the schedule.
  await scheduleApprovalReminders(new Date(base.getTime() + hours[2] * 3_600_000));
  assert.equal(await reminderCount(hours[2]), 1);
  schedule = await db.reminderSchedule.findUniqueOrThrow({ where: { assignmentId: assignment.id } });
  assert.equal(schedule.nextStage, 4);
  assert.equal(schedule.nextReminderAt, null);

  // No further reminders after the final stage.
  await scheduleApprovalReminders(new Date(base.getTime() + 1_000 * 3_600_000));
  const total = await db.notification.count({
    where: { userId: approver.id, requestId: request.id, category: "approval_reminder" },
  });
  assert.equal(total, 3);
});

test("reminders stop after a rejection decision resolves the request", async () => {
  const base = new Date("2026-02-01T00:00:00.000Z");
  const { approver, request, assignment } = await createPendingApproval(base);
  await db.reminderSchedule.create({
    data: { assignmentId: assignment.id, nextStage: 1, nextReminderAt: new Date(base.getTime() + 8 * 3_600_000) },
  });
  // The approver rejects: request leaves PENDING_APPROVAL and the assignment resolves.
  await db.paymentRequest.update({ where: { id: request.id }, data: { status: PaymentStatus.REJECTED } });
  await db.approvalAssignment.update({ where: { id: assignment.id }, data: { resolvedAt: new Date() } });

  await scheduleApprovalReminders(new Date(base.getTime() + 100 * 3_600_000));
  const schedule = await db.reminderSchedule.findUniqueOrThrow({ where: { assignmentId: assignment.id } });
  assert.ok(schedule.canceledAt, "a resolved rejection must cancel the reminder schedule");
  assert.equal(schedule.nextReminderAt, null);
  assert.equal(await db.notification.count({ where: { userId: approver.id, category: "approval_reminder", requestId: request.id } }), 0);
});

test("reminders stop for a reassigned approver whose assignment is resolved", async () => {
  const base = new Date("2026-03-01T00:00:00.000Z");
  const { approver, request, assignment } = await createPendingApproval(base);
  await db.reminderSchedule.create({
    data: { assignmentId: assignment.id, nextStage: 1, nextReminderAt: new Date(base.getTime() + 8 * 3_600_000) },
  });
  // Reassignment resolves the previous approver's assignment while the request stays pending.
  await db.approvalAssignment.update({ where: { id: assignment.id }, data: { resolvedAt: new Date() } });

  await scheduleApprovalReminders(new Date(base.getTime() + 100 * 3_600_000));
  const schedule = await db.reminderSchedule.findUniqueOrThrow({ where: { assignmentId: assignment.id } });
  assert.ok(schedule.canceledAt, "a resolved (reassigned) assignment must cancel the reminder schedule");
  assert.equal(await db.notification.count({ where: { userId: approver.id, category: "approval_reminder", requestId: request.id } }), 0);
});

test("payment due-this-week sweep notifies AP once per payment week", async () => {
  const requestor = await createUser("REQUESTOR");
  const ap = await createUser("ACCOUNTS_PAYABLE");
  const now = new Date();
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const request = await db.paymentRequest.create({
    data: {
      transactionId: `PTR-DUEWEEK-${suffix}`,
      requestorId: requestor.id,
      status: PaymentStatus.APPROVED,
      vendorName: "Due Week Vendor",
      finalValueUsd: "500.00",
      paymentSchedule: {
        create: { plannedDate: weekStart, earliestEligibleDate: weekStart, createdById: requestor.id },
      },
    },
  });
  requestIds.push(request.id);

  await schedulePaymentDueNotifications(now);
  const eventKey = `payment:${request.id}:due_week:${weekStart.toISOString().slice(0, 10)}`;
  const first = await db.notification.findFirst({ where: { userId: ap.id, requestId: request.id, eventKey } });
  assert.ok(first, "AP receives a due-this-week notification");
  assert.equal(first?.title, "Payment due this week");

  // Running the sweep again in the same week must not duplicate the notification.
  await schedulePaymentDueNotifications(now);
  const count = await db.notification.count({ where: { userId: ap.id, requestId: request.id, eventKey } });
  assert.equal(count, 1);
});

test("email delivery retries with backoff and fails after the attempt ceiling", async () => {
  const recipient = await createUser("REQUESTOR");
  const notification = await db.notification.create({
    data: {
      userId: recipient.id,
      eventKey: `worker-email:${suffix}`,
      category: "approval_request",
      templateKey: "approval_request",
      title: "Retry path notification",
      message: "Delivery should fail without SMTP and be retried.",
      href: "/payment-requests/example",
    },
  });
  notificationIds.push(notification.id);
  const base = new Date("2026-04-01T00:00:00.000Z");
  const delivery = await db.emailDelivery.create({
    data: {
      notificationId: notification.id,
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      eventKey: `worker-email:${suffix}:email`,
      status: NotificationDeliveryStatus.PENDING,
      nextAttemptAt: base,
    },
  });

  const observedAttempts: number[] = [];
  const backoffs: number[] = [];
  let now = base;
  for (let cycle = 0; cycle < 6; cycle += 1) {
    await deliverPendingNotifications(now);
    const current = await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    observedAttempts.push(current.attempts);
    assert.equal(current.sentAt, null, "delivery without SMTP must never be marked sent");
    assert.ok(current.lastError, "a failed delivery records an error");
    if (current.status === NotificationDeliveryStatus.FAILED) break;
    assert.equal(current.status, NotificationDeliveryStatus.PENDING);
    assert.ok(current.nextAttemptAt > now, "a retry is scheduled in the future");
    backoffs.push(current.nextAttemptAt.getTime() - now.getTime());
    now = new Date(current.nextAttemptAt.getTime() + 1_000);
  }

  const finalState = await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(finalState.status, NotificationDeliveryStatus.FAILED, "delivery fails after exhausting retries");
  assert.equal(finalState.attempts, 5, "the attempt ceiling is five");
  assert.deepEqual(observedAttempts.slice(0, 5), [1, 2, 3, 4, 5], "each cycle performs exactly one attempt");
  for (let index = 1; index < backoffs.length; index += 1) {
    assert.ok(backoffs[index] >= backoffs[index - 1], "retry backoff is non-decreasing");
  }
});
