// Backend payment-scheduling engine for PAYTRIVA Phase 6.
//
// JSAN pays on a weekly cycle: every Wednesday, with a minimum seven calendar-day
// lead time from the payment request submission date. All arithmetic is performed in
// UTC on date-only values so the result is independent of server and viewer time zones.
// This module is pure (no I/O) so it can be unit tested and reused on the backend.

export const PAYMENT_WEEKDAY_UTC = 3; // Wednesday, per Date.prototype.getUTCDay().
export const MINIMUM_LEAD_DAYS = 7;
export const DUE_THIS_WEEK_WINDOW_DAYS = 7;

export type PaymentRiskStatus = "ON_TRACK" | "AT_RISK";

export type PaymentTrackingCategory =
  | "COMPLETED"
  | "OVERDUE"
  | "AT_RISK"
  | "DUE_THIS_WEEK"
  | "UPCOMING"
  | "UNSCHEDULED";

const MS_PER_DAY = 86_400_000;

/** Collapse any instant to UTC midnight of the same calendar day. */
export function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Add whole calendar days to a UTC date-only value. */
export function addUtcDays(date: Date, days: number): Date {
  return new Date(toUtcDateOnly(date).getTime() + days * MS_PER_DAY);
}

/** Difference in whole calendar days (b - a), UTC date-only. */
export function utcDayDiff(a: Date, b: Date): number {
  return Math.round((toUtcDateOnly(b).getTime() - toUtcDateOnly(a).getTime()) / MS_PER_DAY);
}

/** Format a date as an ISO calendar day (YYYY-MM-DD) in UTC. */
export function toIsoDay(date: Date): string {
  return toUtcDateOnly(date).toISOString().slice(0, 10);
}

/** The first Wednesday on or after the supplied date (returns the date itself if it is a Wednesday). */
export function nextWednesdayOnOrAfter(date: Date): Date {
  const day = toUtcDateOnly(date);
  const offset = (PAYMENT_WEEKDAY_UTC - day.getUTCDay() + 7) % 7;
  return addUtcDays(day, offset);
}

/** Earliest date a payment may be processed: submission date plus the minimum lead time. */
export function earliestEligiblePaymentDate(submissionDate: Date, leadDays = MINIMUM_LEAD_DAYS): Date {
  return addUtcDays(submissionDate, leadDays);
}

export type ScheduleComputation = {
  earliestEligibleDate: Date; // submission + lead days (date-only)
  scheduledPaymentDate: Date; // next eligible Wednesday on/after the earliest eligible date
  riskStatus: PaymentRiskStatus; // AT_RISK when the earliest eligible Wednesday falls after the invoice due date
  meetsDueDate: boolean;
};

/**
 * Compute the earliest eligible Wednesday payment date for a request and whether it can
 * still meet the original invoice due date. The invoice due date is never modified here;
 * it is only compared against the computed schedule.
 */
export function computePaymentSchedule(params: {
  submissionDate: Date;
  dueDate?: Date | null;
  leadDays?: number;
}): ScheduleComputation {
  const earliestEligibleDate = earliestEligiblePaymentDate(params.submissionDate, params.leadDays);
  const scheduledPaymentDate = nextWednesdayOnOrAfter(earliestEligibleDate);
  const meetsDueDate = params.dueDate
    ? scheduledPaymentDate.getTime() <= toUtcDateOnly(params.dueDate).getTime()
    : true;
  return {
    earliestEligibleDate,
    scheduledPaymentDate,
    riskStatus: meetsDueDate ? "ON_TRACK" : "AT_RISK",
    meetsDueDate,
  };
}

/** Upcoming Wednesday payment-cycle dates, starting from the first eligible Wednesday on/after `from`. */
export function upcomingWednesdays(from: Date, count: number): Date[] {
  const cycles: Date[] = [];
  let cursor = nextWednesdayOnOrAfter(from);
  for (let index = 0; index < count; index += 1) {
    cycles.push(cursor);
    cursor = addUtcDays(cursor, 7);
  }
  return cycles;
}

/**
 * Derive the live tracking category for a payment from its stored dates and status.
 * Pure so it can be unit tested and shared by every calendar/summary endpoint.
 *
 * - COMPLETED: the payment has been confirmed (status PAID).
 * - OVERDUE: an approved, unpaid invoice whose due date has already passed.
 * - AT_RISK: an approved, unpaid invoice that cannot be paid on an eligible Wednesday on
 *   or before its due date (and is not yet past due).
 * - DUE_THIS_WEEK: an approved, unpaid invoice whose effective payment date falls within
 *   the current payment week window.
 * - UPCOMING: an approved, unpaid invoice scheduled further out.
 * - UNSCHEDULED: anything else (e.g. awaiting approval) — never treated as overdue.
 */
export function derivePaymentCategory(params: {
  isPaid: boolean;
  isApproved: boolean;
  scheduledPaymentDate?: Date | null;
  earliestEligibleDate?: Date | null;
  dueDate?: Date | null;
  riskStatus?: PaymentRiskStatus | null;
  now: Date;
}): PaymentTrackingCategory {
  if (params.isPaid) return "COMPLETED";
  if (!params.isApproved) return "UNSCHEDULED";

  const today = toUtcDateOnly(params.now);
  const due = params.dueDate ? toUtcDateOnly(params.dueDate) : null;
  if (due && due.getTime() < today.getTime()) return "OVERDUE";

  // An explicitly flagged at-risk invoice, or one whose earliest eligible Wednesday
  // still falls after its due date, needs AP attention before anything else upcoming.
  const effective = params.scheduledPaymentDate ?? params.earliestEligibleDate ?? null;
  const atRiskByDate = Boolean(due && effective && effective.getTime() > due.getTime());
  if (params.riskStatus === "AT_RISK" || atRiskByDate) return "AT_RISK";

  if (effective) {
    const diff = utcDayDiff(today, effective);
    if (diff >= 0 && diff < DUE_THIS_WEEK_WINDOW_DAYS) return "DUE_THIS_WEEK";
    return "UPCOMING";
  }
  // Approved without any scheduled/eligible date yet.
  if (due) {
    const diff = utcDayDiff(today, due);
    if (diff >= 0 && diff < DUE_THIS_WEEK_WINDOW_DAYS) return "DUE_THIS_WEEK";
  }
  return "UPCOMING";
}
