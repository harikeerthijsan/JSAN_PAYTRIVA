import "server-only";
import { NotificationDeliveryStatus, PaymentStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { deliverNotificationEmail } from "@/lib/notification-email";
import { getNotificationSettings } from "@/lib/notification-settings";
import { defaultReminderHours } from "@/lib/notification-settings";
import { queueNotification } from "@/lib/notifications";

const maximumAttempts = 5;

function isReminderHours(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 3 && value.every((hour) => Number.isInteger(hour) && hour >= 1);
}

function reminderMessage(hours: number, transactionId: string): string {
  return `Reminder: approval for ${transactionId} has been pending for ${hours} hours. Please review the request.`;
}

export async function scheduleApprovalReminders(now = new Date()): Promise<number> {
  const { reminderHours } = await getNotificationSettings();
  const hours = isReminderHours(reminderHours) ? reminderHours : [...defaultReminderHours];
  const due = await db.reminderSchedule.findMany({
    where: { canceledAt: null, nextReminderAt: { lte: now }, nextStage: { in: [1, 2, 3] } },
    orderBy: { nextReminderAt: "asc" },
    take: 100,
    include: {
      assignment: {
        include: {
          approver: { select: { id: true } },
          request: {
            select: {
              id: true, transactionId: true, status: true, vendorName: true, invoiceNumber: true,
              project: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  let scheduled = 0;
  for (const schedule of due) {
    try {
      const result = await db.$transaction(async (tx) => {
        const current = await tx.reminderSchedule.findUnique({
          where: { id: schedule.id },
          include: { assignment: { include: { request: { select: { status: true, transactionId: true } } } } },
        });
        if (!current || current.canceledAt || !current.nextReminderAt || current.nextReminderAt > now) return false;
        if (current.assignment.resolvedAt || current.assignment.request.status !== PaymentStatus.PENDING_APPROVAL) {
          await tx.reminderSchedule.update({ where: { id: current.id }, data: { canceledAt: now, nextReminderAt: null } });
          return false;
        }
        const stage = current.nextStage;
        if (stage < 1 || stage > 3) {
          await tx.reminderSchedule.update({ where: { id: current.id }, data: { nextReminderAt: null } });
          return false;
        }
        const changed = await tx.reminderSchedule.updateMany({
          where: { id: current.id, nextReminderAt: current.nextReminderAt, nextStage: stage, canceledAt: null },
          data: {
            nextStage: stage + 1,
            nextReminderAt: stage < 3
              ? new Date(current.assignment.assignedAt.getTime() + hours[stage] * 60 * 60 * 1000)
              : null,
          },
        });
        if (changed.count !== 1) return false;
        const hour = hours[stage - 1];
        await queueNotification(tx, {
          userId: schedule.assignment.approverId,
          requestId: schedule.assignment.request.id,
          eventKey: `approval:${schedule.assignmentId}:reminder:${hour}h`,
          category: "approval_reminder",
          title: `Approval reminder · ${hour} hours`,
          message: reminderMessage(hour, schedule.assignment.request.transactionId),
          href: `/payment-requests/${schedule.assignment.request.id}`,
        });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (result) scheduled += 1;
    } catch (error) {
      console.error("Unable to schedule an approval reminder.", error);
    }
  }
  return scheduled;
}

type DueItem = { id: string; transactionId: string; kind: "due" | "overdue" | "due_week"; dateIso: string };

export async function schedulePaymentDueNotifications(now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  const weekEnd = new Date(start.getTime() + 7 * 86_400_000);
  const [dueToday, overdue, dueThisWeek] = await Promise.all([
    // Overdue and due-today are measured against the original invoice due date.
    db.paymentRequest.findMany({
      where: { status: PaymentStatus.APPROVED, dueDate: { gte: start, lt: end } },
      select: { id: true, transactionId: true, dueDate: true },
      take: 300,
    }),
    db.paymentRequest.findMany({
      where: { status: PaymentStatus.APPROVED, dueDate: { lt: start } },
      select: { id: true, transactionId: true, dueDate: true },
      take: 300,
    }),
    // Due-this-week is measured against the scheduled Wednesday payment date.
    db.paymentRequest.findMany({
      where: { status: PaymentStatus.APPROVED, paymentSchedule: { plannedDate: { gte: start, lt: weekEnd } } },
      select: { id: true, transactionId: true, paymentSchedule: { select: { plannedDate: true } } },
      take: 300,
    }),
  ]);
  const apUsers = await db.user.findMany({
    where: { isActive: true, roles: { some: { role: { key: "ACCOUNTS_PAYABLE" } } } },
    select: { id: true },
  });
  const weekStartIso = start.toISOString().slice(0, 10);
  const items: DueItem[] = [
    ...dueToday.flatMap((request) => (request.dueDate ? [{ id: request.id, transactionId: request.transactionId, kind: "due" as const, dateIso: request.dueDate.toISOString().slice(0, 10) }] : [])),
    ...overdue.flatMap((request) => (request.dueDate ? [{ id: request.id, transactionId: request.transactionId, kind: "overdue" as const, dateIso: request.dueDate.toISOString().slice(0, 10) }] : [])),
    ...dueThisWeek.flatMap((request) => (request.paymentSchedule?.plannedDate ? [{ id: request.id, transactionId: request.transactionId, kind: "due_week" as const, dateIso: request.paymentSchedule.plannedDate.toISOString().slice(0, 10) }] : [])),
  ];
  let scheduled = 0;
  for (const item of items) {
    // Due-this-week fires at most once per payment week; due/overdue are keyed by the invoice due date.
    const eventKey = item.kind === "due_week"
      ? `payment:${item.id}:due_week:${weekStartIso}`
      : `payment:${item.id}:${item.kind}:${item.dateIso}`;
    const title = item.kind === "overdue" ? "Invoice overdue" : item.kind === "due_week" ? "Payment due this week" : "Payment due today";
    const message = item.kind === "overdue"
      ? `${item.transactionId} is overdue (invoice due ${item.dateIso}).`
      : item.kind === "due_week"
        ? `${item.transactionId} is scheduled for payment on ${item.dateIso} in the current payment week.`
        : `${item.transactionId} is due today (${item.dateIso}).`;
    for (const recipient of apUsers) {
      await db.$transaction(async (tx) => {
        await queueNotification(tx, {
          userId: recipient.id,
          requestId: item.id,
          eventKey,
          category: "ap_updates",
          templateKey: "ap_update",
          title,
          message,
          href: `/payment-requests/${item.id}`,
        });
      });
      scheduled += 1;
    }
  }
  return scheduled;
}

function sanitizeDeliveryError(error: unknown): string {
  if (error instanceof Error && ["EMAIL_DELIVERY_NOT_CONFIGURED", "EMAIL_SENDER_NOT_CONFIGURED", "EMAIL_DELIVERY_DISABLED", "APP_URL_MUST_USE_HTTPS"].includes(error.message)) return error.message;
  return "Temporary email delivery error.";
}

export async function deliverPendingNotifications(now = new Date()): Promise<{ sent: number; failed: number }> {
  const pending = await db.emailDelivery.findMany({
    where: {
      OR: [
        { status: NotificationDeliveryStatus.PENDING, nextAttemptAt: { lte: now } },
        { status: NotificationDeliveryStatus.SENDING, updatedAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    include: {
      recipient: { select: { timeZone: true } },
      notification: {
        include: {
          request: {
            include: {
              project: { select: { name: true } },
              requestor: { select: { fullName: true } },
            },
          },
        },
      },
    },
  });
  let sent = 0;
  let failed = 0;
  for (const delivery of pending) {
    const claimed = await db.emailDelivery.updateMany({
      where: {
        id: delivery.id,
        status: delivery.status,
        updatedAt: delivery.updatedAt,
        ...(delivery.status === NotificationDeliveryStatus.PENDING ? { nextAttemptAt: { lte: now } } : {}),
      },
      data: { status: NotificationDeliveryStatus.SENDING, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    const request = delivery.notification.request;
    const attempt = delivery.attempts + 1;
    try {
      await deliverNotificationEmail(delivery.recipientEmail, {
        title: delivery.notification.title,
        message: delivery.notification.message,
        href: delivery.notification.href,
        transactionId: request?.transactionId,
        vendorName: request?.vendorName,
        invoiceNumber: request?.invoiceNumber,
        projectName: request?.project?.name,
        invoiceAmountUsd: request?.finalValueUsd?.toString(),
        requestorName: request?.requestor.fullName,
        actionDateTime: delivery.notification.createdAt.toLocaleString("en-US", {
          timeZone: delivery.recipient.timeZone,
          timeZoneName: "short",
        }),
        timeZone: delivery.recipient.timeZone,
        templateKey: delivery.notification.templateKey ?? undefined,
      }, delivery.notification.category);
      await db.emailDelivery.update({
        where: { id: delivery.id },
        data: { status: NotificationDeliveryStatus.SENT, sentAt: new Date(), lastError: null },
      });
      sent += 1;
    } catch (error) {
      const exhausted = attempt >= maximumAttempts;
      const retryDelayMs = Math.min(60 * 60 * 1000, 30_000 * (2 ** (attempt - 1)));
      await db.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: exhausted ? NotificationDeliveryStatus.FAILED : NotificationDeliveryStatus.PENDING,
          nextAttemptAt: new Date(now.getTime() + retryDelayMs),
          lastError: sanitizeDeliveryError(error),
        },
      });
      failed += 1;
    }
  }
  return { sent, failed };
}

export async function runNotificationJobs(now = new Date()) {
  const [reminders, paymentEvents, email] = await Promise.all([
    scheduleApprovalReminders(now),
    schedulePaymentDueNotifications(now),
    deliverPendingNotifications(now),
  ]);
  return { reminders, paymentEvents, email };
}
