import "server-only";
import { PaymentRiskStatus, PaymentStatus, Prisma } from "@/generated/prisma/client";
import { computePaymentSchedule, nextWednesdayOnOrAfter, toIsoDay, toUtcDateOnly } from "@/lib/payment-scheduling";
import { queueNotification } from "@/lib/notifications";

type Tx = Prisma.TransactionClient;

export class ScheduleError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

const scheduleSelect = {
  id: true,
  transactionId: true,
  requestorId: true,
  status: true,
  submittedAt: true,
  createdAt: true,
  dueDate: true,
  vendorName: true,
  invoiceNumber: true,
  finalValueUsd: true,
  currencyCode: true,
  project: { select: { name: true } },
  paymentSchedule: { select: { plannedDate: true, autoScheduled: true, riskStatus: true } },
} satisfies Prisma.PaymentRequestSelect;

async function activeApUserIds(tx: Tx): Promise<string[]> {
  const users = await tx.user.findMany({
    where: { isActive: true, roles: { some: { role: { key: "ACCOUNTS_PAYABLE" } } } },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

function riskFor(scheduledDate: Date | null, dueDate: Date | null): PaymentRiskStatus {
  if (!scheduledDate || !dueDate) return PaymentRiskStatus.ON_TRACK;
  return scheduledDate.getTime() > toUtcDateOnly(dueDate).getTime() ? PaymentRiskStatus.AT_RISK : PaymentRiskStatus.ON_TRACK;
}

async function notifyScheduled(
  tx: Tx,
  request: { id: string; transactionId: string; requestorId: string; vendorName: string | null; invoiceNumber: string | null; project: { name: string } | null },
  scheduledDate: Date,
  riskStatus: PaymentRiskStatus,
  changed: boolean,
) {
  const iso = toIsoDay(scheduledDate);
  // Requestor is told their payment has a scheduled Wednesday (or that it moved).
  await queueNotification(tx, {
    userId: request.requestorId,
    requestId: request.id,
    eventKey: `payment:${request.id}:${changed ? "rescheduled" : "scheduled"}:${iso}`,
    category: "ap_updates",
    templateKey: "ap_update",
    title: changed ? "Payment schedule updated" : "Payment scheduled",
    message: `${request.transactionId} is scheduled for payment on ${iso} (JSAN Wednesday cycle).`,
    href: `/payment-requests/${request.id}`,
  });
  // When the earliest eligible Wednesday falls after the invoice due date AP must intervene.
  if (riskStatus === PaymentRiskStatus.AT_RISK) {
    for (const apUserId of await activeApUserIds(tx)) {
      await queueNotification(tx, {
        userId: apUserId,
        requestId: request.id,
        eventKey: `payment:${request.id}:at_risk:${iso}`,
        category: "ap_updates",
        templateKey: "ap_update",
        title: "Payment at risk",
        message: `${request.transactionId} · ${request.vendorName ?? "Vendor"} · ${request.invoiceNumber ?? "No invoice number"} cannot be paid on an eligible Wednesday on or before its due date.`,
        href: `/payment-requests/${request.id}`,
      });
    }
  }
}

/**
 * Compute and persist the earliest eligible Wednesday schedule for a newly approved request.
 * Idempotent: re-running keeps an existing AP override and never duplicates records or
 * notifications (notification event keys are date-stamped and deduplicated upstream).
 */
export async function autoSchedulePayment(tx: Tx, requestId: string, actorId: string | null): Promise<void> {
  const request = await tx.paymentRequest.findUnique({ where: { id: requestId }, select: scheduleSelect });
  if (!request || request.status !== PaymentStatus.APPROVED) return;

  const submission = request.submittedAt ?? request.createdAt;
  const computation = computePaymentSchedule({ submissionDate: submission, dueDate: request.dueDate });

  // Respect an existing manual AP schedule; only (re)compute risk against it.
  const manual = request.paymentSchedule && !request.paymentSchedule.autoScheduled && request.paymentSchedule.plannedDate;
  const scheduledDate = manual ? request.paymentSchedule!.plannedDate! : computation.scheduledPaymentDate;
  const riskStatus = manual ? riskFor(scheduledDate, request.dueDate) : computation.riskStatus;

  const existing = request.paymentSchedule?.plannedDate ?? null;
  const changed = !existing || existing.getTime() !== scheduledDate.getTime();

  await tx.paymentSchedule.upsert({
    where: { requestId },
    create: {
      requestId,
      plannedDate: scheduledDate,
      earliestEligibleDate: computation.earliestEligibleDate,
      riskStatus,
      autoScheduled: !manual,
      createdById: actorId ?? request.requestorId,
    },
    update: {
      plannedDate: scheduledDate,
      earliestEligibleDate: computation.earliestEligibleDate,
      riskStatus,
      autoScheduled: manual ? false : true,
    },
  });

  await tx.paymentScheduleHistory.create({
    data: {
      requestId,
      actorId,
      action: manual ? "AUTO_RISK_RECHECK" : "AUTO_SCHEDULED",
      scheduledDate,
      earliestEligibleDate: computation.earliestEligibleDate,
      dueDate: request.dueDate,
      riskStatus,
      note: manual
        ? "Risk re-evaluated against the existing manual schedule on approval."
        : `Auto-scheduled to the earliest eligible Wednesday (${toIsoDay(scheduledDate)}).`,
    },
  });

  if (changed || riskStatus === PaymentRiskStatus.AT_RISK) {
    await notifyScheduled(tx, request, scheduledDate, riskStatus, Boolean(existing) && changed);
  }
}

/**
 * Apply an AP manual reschedule (or clear). Enforces the seven-day minimum lead time,
 * recomputes risk against the invoice due date, records scheduling history, and notifies.
 * The invoice due date itself is never changed.
 */
export async function reschedulePayment(
  tx: Tx,
  input: { requestId: string; actorId: string; plannedDate: Date | null; remarks?: string | null },
): Promise<{ plannedDate: string | null; riskStatus: PaymentRiskStatus; earliestEligibleDate: string | null }> {
  const request = await tx.paymentRequest.findUnique({ where: { id: input.requestId }, select: scheduleSelect });
  if (!request) throw new ScheduleError("NOT_FOUND", "Payment request not found.");
  if (request.status !== PaymentStatus.APPROVED) throw new ScheduleError("NOT_APPROVED", "Only approved, unpaid requests can be scheduled.");

  const submission = request.submittedAt ?? request.createdAt;
  const computation = computePaymentSchedule({ submissionDate: submission, dueDate: request.dueDate });

  if (input.plannedDate) {
    const planned = toUtcDateOnly(input.plannedDate);
    if (planned.getTime() < computation.earliestEligibleDate.getTime()) {
      throw new ScheduleError(
        "BEFORE_MINIMUM",
        `The earliest eligible payment date is ${toIsoDay(computation.earliestEligibleDate)} (submission date plus seven calendar days).`,
      );
    }
  }

  const scheduledDate = input.plannedDate ? toUtcDateOnly(input.plannedDate) : null;
  const riskStatus = riskFor(scheduledDate, request.dueDate);
  const existing = request.paymentSchedule?.plannedDate ?? null;

  const schedule = await tx.paymentSchedule.upsert({
    where: { requestId: input.requestId },
    create: {
      requestId: input.requestId,
      plannedDate: scheduledDate,
      earliestEligibleDate: computation.earliestEligibleDate,
      riskStatus,
      autoScheduled: false,
      remarks: input.remarks || null,
      createdById: input.actorId,
    },
    update: {
      plannedDate: scheduledDate,
      earliestEligibleDate: computation.earliestEligibleDate,
      riskStatus,
      autoScheduled: false,
      remarks: input.remarks || null,
    },
  });

  await tx.paymentScheduleHistory.create({
    data: {
      requestId: input.requestId,
      actorId: input.actorId,
      action: scheduledDate ? "RESCHEDULED" : "SCHEDULE_CLEARED",
      scheduledDate,
      earliestEligibleDate: computation.earliestEligibleDate,
      dueDate: request.dueDate,
      riskStatus,
      note: scheduledDate
        ? `Payment date set to ${toIsoDay(scheduledDate)}.${input.remarks ? ` ${input.remarks}` : ""}`
        : "Scheduled payment date cleared.",
    },
  });

  if (scheduledDate) {
    const changed = !existing || existing.getTime() !== scheduledDate.getTime();
    if (changed || riskStatus === PaymentRiskStatus.AT_RISK) {
      await notifyScheduled(tx, request, scheduledDate, riskStatus, Boolean(existing) && changed);
    }
  }

  return {
    plannedDate: schedule.plannedDate ? toIsoDay(schedule.plannedDate) : null,
    riskStatus: schedule.riskStatus,
    earliestEligibleDate: schedule.earliestEligibleDate ? toIsoDay(schedule.earliestEligibleDate) : null,
  };
}

/** Suggested earliest eligible Wednesday for display (no persistence). */
export function suggestSchedule(submissionDate: Date, dueDate: Date | null) {
  const computation = computePaymentSchedule({ submissionDate, dueDate });
  return {
    earliestEligibleDate: toIsoDay(computation.earliestEligibleDate),
    scheduledPaymentDate: toIsoDay(computation.scheduledPaymentDate),
    nextWednesday: toIsoDay(nextWednesdayOnOrAfter(new Date())),
    riskStatus: computation.riskStatus,
    meetsDueDate: computation.meetsDueDate,
  };
}
