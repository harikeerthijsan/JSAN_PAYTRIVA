import "server-only";
import { PaymentStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  derivePaymentCategory,
  nextWednesdayOnOrAfter,
  type PaymentTrackingCategory,
  toIsoDay,
  toUtcDateOnly,
  upcomingWednesdays,
} from "@/lib/payment-scheduling";

export type CalendarActor = { id: string; permissions: string[] };

export type CalendarFilters = {
  from?: Date | null;
  to?: Date | null;
  vendor?: string | null;
  projectId?: string | null;
  category?: PaymentTrackingCategory | null;
};

const MAX_ROWS = 1000;

/**
 * Role-scoped visibility (enforced on the backend):
 * - payments:read_all  → AP and management see every request (consolidated view).
 * - approvals:access   → approvers see requests assigned to them.
 * - payments:read_own  → requestors see only their own requests.
 * Returns null when the actor may not see any payment data.
 */
export function buildScopeFilter(actor: CalendarActor): Prisma.PaymentRequestWhereInput | null {
  if (actor.permissions.includes("payments:read_all")) return {};
  const scopes: Prisma.PaymentRequestWhereInput[] = [];
  if (actor.permissions.includes("approvals:access")) {
    scopes.push({ approvalAssignments: { some: { approverId: actor.id } } });
  }
  if (actor.permissions.includes("payments:read_own") || actor.permissions.includes("payments:create")) {
    scopes.push({ requestorId: actor.id });
  }
  if (!scopes.length) return null;
  return scopes.length === 1 ? scopes[0] : { OR: scopes };
}

const calendarInclude = {
  project: { select: { id: true, name: true } },
  currency: { select: { code: true } },
  paymentSchedule: { select: { plannedDate: true, earliestEligibleDate: true, riskStatus: true, remarks: true } },
  paymentConfirmation: { select: { actualPaymentDate: true, amountPaid: true, amountPaidUsd: true, currencyCode: true, paymentReference: true } },
} satisfies Prisma.PaymentRequestInclude;

type CalendarRecord = Prisma.PaymentRequestGetPayload<{ include: typeof calendarInclude }>;

function decimalString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

export type CalendarEntry = ReturnType<typeof mapEntry>;

function mapEntry(record: CalendarRecord, now: Date) {
  const isPaid = record.status === PaymentStatus.PAID;
  const scheduled = record.paymentSchedule?.plannedDate ?? null;
  const actual = record.paymentConfirmation?.actualPaymentDate ?? null;
  const effective = isPaid ? actual : scheduled ?? record.dueDate ?? null;
  const category = derivePaymentCategory({
    isPaid,
    isApproved: record.status === PaymentStatus.APPROVED,
    scheduledPaymentDate: scheduled,
    earliestEligibleDate: record.paymentSchedule?.earliestEligibleDate ?? null,
    dueDate: record.dueDate,
    riskStatus: record.paymentSchedule?.riskStatus ?? null,
    now,
  });
  return {
    id: record.id,
    transactionId: record.transactionId,
    vendorName: record.vendorName,
    invoiceNumber: record.invoiceNumber,
    projectId: record.project?.id ?? null,
    projectName: record.project?.name ?? "—",
    invoiceAmount: decimalString(record.invoiceAmount),
    finalValueUsd: decimalString(record.finalValueUsd),
    currencyCode: record.currency?.code ?? record.currencyCode ?? null,
    status: record.status,
    category,
    riskStatus: record.paymentSchedule?.riskStatus ?? "ON_TRACK",
    dueDate: record.dueDate ? toIsoDay(record.dueDate) : null,
    earliestEligibleDate: record.paymentSchedule?.earliestEligibleDate ? toIsoDay(record.paymentSchedule.earliestEligibleDate) : null,
    scheduledPaymentDate: scheduled ? toIsoDay(scheduled) : null,
    actualPaymentDate: actual ? toIsoDay(actual) : null,
    paymentDate: effective ? toIsoDay(effective) : null,
    isWednesday: scheduled ? toUtcDateOnly(scheduled).getUTCDay() === 3 : false,
    actualPaidAmountUsd: decimalString(record.paymentConfirmation?.amountPaidUsd ?? null),
    paidCurrencyCode: record.paymentConfirmation?.currencyCode ?? null,
    paymentReference: record.paymentConfirmation?.paymentReference ?? null,
    scheduleRemarks: record.paymentSchedule?.remarks ?? null,
  };
}

function baseWhere(scope: Prisma.PaymentRequestWhereInput, filters: CalendarFilters): Prisma.PaymentRequestWhereInput {
  const dateRange = filters.from || filters.to ? {
    gte: filters.from ?? undefined,
    lte: filters.to ?? undefined,
  } : undefined;
  return {
    AND: [
      scope,
      { status: { in: [PaymentStatus.APPROVED, PaymentStatus.PAID] } },
      filters.projectId ? { projectId: filters.projectId } : {},
      filters.vendor ? { vendorName: { contains: filters.vendor, mode: "insensitive" } } : {},
      dateRange
        ? {
            OR: [
              { status: PaymentStatus.APPROVED, paymentSchedule: { plannedDate: dateRange } },
              { status: PaymentStatus.APPROVED, paymentSchedule: { is: null }, dueDate: dateRange },
              { status: PaymentStatus.PAID, paymentConfirmation: { actualPaymentDate: dateRange } },
            ],
          }
        : {},
    ],
  };
}

export async function loadCalendar(scope: Prisma.PaymentRequestWhereInput, filters: CalendarFilters, now = new Date()) {
  const records = await db.paymentRequest.findMany({
    where: baseWhere(scope, filters),
    orderBy: [{ paymentSchedule: { plannedDate: "asc" } }, { dueDate: "asc" }, { createdAt: "asc" }],
    take: MAX_ROWS,
    include: calendarInclude,
  });
  const entries = records.map((record) => mapEntry(record, now));
  const filtered = filters.category ? entries.filter((entry) => entry.category === filters.category) : entries;
  const counts: Record<PaymentTrackingCategory, number> = {
    COMPLETED: 0, OVERDUE: 0, AT_RISK: 0, DUE_THIS_WEEK: 0, UPCOMING: 0, UNSCHEDULED: 0,
  };
  for (const entry of entries) counts[entry.category] += 1;
  return {
    entries: filtered,
    categoryCounts: counts,
    wednesdayCycles: upcomingWednesdays(now, 6).map(toIsoDay),
    capped: records.length === MAX_ROWS,
  };
}

/** Upcoming approved payments grouped by their scheduled Wednesday pay date. */
export async function loadUpcoming(scope: Prisma.PaymentRequestWhereInput, filters: CalendarFilters, now = new Date()) {
  const records = await db.paymentRequest.findMany({
    where: {
      AND: [
        scope,
        { status: PaymentStatus.APPROVED },
        filters.projectId ? { projectId: filters.projectId } : {},
        filters.vendor ? { vendorName: { contains: filters.vendor, mode: "insensitive" } } : {},
      ],
    },
    take: MAX_ROWS,
    include: calendarInclude,
  });
  const today = toUtcDateOnly(now);
  type Group = {
    date: string;
    isWednesday: boolean;
    count: number;
    totalUsd: Prisma.Decimal;
    byCurrency: Map<string, { count: number; totalOriginal: Prisma.Decimal; totalUsd: Prisma.Decimal }>;
    byProject: Map<string, { count: number; totalUsd: Prisma.Decimal }>;
  };
  const groups = new Map<string, Group>();
  const from = filters.from ? toUtcDateOnly(filters.from) : null;
  const to = filters.to ? toUtcDateOnly(filters.to) : null;
  for (const record of records) {
    const scheduled = record.paymentSchedule?.plannedDate
      ? toUtcDateOnly(record.paymentSchedule.plannedDate)
      : nextWednesdayOnOrAfter(record.dueDate ?? now);
    if (scheduled.getTime() < today.getTime()) continue; // upcoming only
    if (from && scheduled.getTime() < from.getTime()) continue;
    if (to && scheduled.getTime() > to.getTime()) continue;
    const key = toIsoDay(scheduled);
    const group = groups.get(key) ?? {
      date: key,
      isWednesday: scheduled.getUTCDay() === 3,
      count: 0,
      totalUsd: new Prisma.Decimal(0),
      byCurrency: new Map(),
      byProject: new Map(),
    };
    const usd = record.finalValueUsd ?? new Prisma.Decimal(0);
    group.count += 1;
    group.totalUsd = group.totalUsd.plus(usd);
    const currency = record.currency?.code ?? record.currencyCode ?? "—";
    const currencyEntry = group.byCurrency.get(currency) ?? { count: 0, totalOriginal: new Prisma.Decimal(0), totalUsd: new Prisma.Decimal(0) };
    currencyEntry.count += 1;
    currencyEntry.totalOriginal = currencyEntry.totalOriginal.plus(record.invoiceAmount ?? new Prisma.Decimal(0));
    currencyEntry.totalUsd = currencyEntry.totalUsd.plus(usd);
    group.byCurrency.set(currency, currencyEntry);
    const project = record.project?.name ?? "Unassigned";
    const projectEntry = group.byProject.get(project) ?? { count: 0, totalUsd: new Prisma.Decimal(0) };
    projectEntry.count += 1;
    projectEntry.totalUsd = projectEntry.totalUsd.plus(usd);
    group.byProject.set(project, projectEntry);
    groups.set(key, group);
  }
  const sorted = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    cycles: sorted.map((group) => ({
      date: group.date,
      isWednesday: group.isWednesday,
      count: group.count,
      totalUsd: group.totalUsd.toFixed(2),
      byCurrency: [...group.byCurrency.entries()].map(([code, value]) => ({ code, count: value.count, totalOriginal: value.totalOriginal.toFixed(2), totalUsd: value.totalUsd.toFixed(2) })),
      byProject: [...group.byProject.entries()].map(([name, value]) => ({ name, count: value.count, totalUsd: value.totalUsd.toFixed(2) })),
    })),
    nextWednesday: toIsoDay(nextWednesdayOnOrAfter(now)),
    capped: records.length === MAX_ROWS,
  };
}

/** Financial tracking KPIs and breakdowns in the USD reporting currency. */
export async function loadSummary(scope: Prisma.PaymentRequestWhereInput, now = new Date()) {
  const records = await db.paymentRequest.findMany({
    where: { AND: [scope, { status: { in: [PaymentStatus.APPROVED, PaymentStatus.PAID] } }] },
    take: MAX_ROWS * 2,
    include: calendarInclude,
  });
  const zero = () => new Prisma.Decimal(0);
  const totals = {
    upcoming: zero(), dueThisWeek: zero(), overdue: zero(), paid: zero(), outstandingApproved: zero(), atRisk: zero(),
  };
  const counts = { upcoming: 0, dueThisWeek: 0, overdue: 0, paid: 0, outstandingApproved: 0, atRisk: 0 };
  const byCurrency = new Map<string, { count: number; totalUsd: Prisma.Decimal; totalOriginal: Prisma.Decimal }>();
  const byProject = new Map<string, { count: number; totalUsd: Prisma.Decimal }>();
  const byVendor = new Map<string, { count: number; totalUsd: Prisma.Decimal }>();

  for (const record of records) {
    const entry = mapEntry(record, now);
    const isPaid = record.status === PaymentStatus.PAID;
    const usd = isPaid
      ? record.paymentConfirmation?.amountPaidUsd ?? zero()
      : record.finalValueUsd ?? zero();

    if (isPaid) {
      totals.paid = totals.paid.plus(usd);
      counts.paid += 1;
    } else {
      totals.outstandingApproved = totals.outstandingApproved.plus(usd);
      counts.outstandingApproved += 1;
      if (entry.category === "OVERDUE") { totals.overdue = totals.overdue.plus(usd); counts.overdue += 1; }
      else if (entry.category === "AT_RISK") { totals.atRisk = totals.atRisk.plus(usd); counts.atRisk += 1; }
      else if (entry.category === "DUE_THIS_WEEK") { totals.dueThisWeek = totals.dueThisWeek.plus(usd); counts.dueThisWeek += 1; }
      else if (entry.category === "UPCOMING") { totals.upcoming = totals.upcoming.plus(usd); counts.upcoming += 1; }
    }

    const currency = record.currency?.code ?? record.currencyCode ?? "—";
    const c = byCurrency.get(currency) ?? { count: 0, totalUsd: zero(), totalOriginal: zero() };
    c.count += 1; c.totalUsd = c.totalUsd.plus(usd);
    c.totalOriginal = c.totalOriginal.plus(isPaid ? record.paymentConfirmation?.amountPaid ?? zero() : record.invoiceAmount ?? zero());
    byCurrency.set(currency, c);

    const project = record.project?.name ?? "Unassigned";
    const p = byProject.get(project) ?? { count: 0, totalUsd: zero() };
    p.count += 1; p.totalUsd = p.totalUsd.plus(usd); byProject.set(project, p);

    const vendor = record.vendorName ?? "Unknown vendor";
    const v = byVendor.get(vendor) ?? { count: 0, totalUsd: zero() };
    v.count += 1; v.totalUsd = v.totalUsd.plus(usd); byVendor.set(vendor, v);
  }

  const fixed = (value: Prisma.Decimal) => value.toFixed(2);
  return {
    reportingCurrency: "USD",
    totals: {
      upcomingUsd: fixed(totals.upcoming),
      dueThisWeekUsd: fixed(totals.dueThisWeek),
      overdueUsd: fixed(totals.overdue),
      atRiskUsd: fixed(totals.atRisk),
      paidUsd: fixed(totals.paid),
      outstandingApprovedUsd: fixed(totals.outstandingApproved),
    },
    counts,
    byCurrency: [...byCurrency.entries()].map(([code, value]) => ({ code, count: value.count, totalUsd: fixed(value.totalUsd), totalOriginal: fixed(value.totalOriginal) })).sort((a, b) => Number(b.totalUsd) - Number(a.totalUsd)),
    byProject: [...byProject.entries()].map(([name, value]) => ({ name, count: value.count, totalUsd: fixed(value.totalUsd) })).sort((a, b) => Number(b.totalUsd) - Number(a.totalUsd)),
    byVendor: [...byVendor.entries()].map(([name, value]) => ({ name, count: value.count, totalUsd: fixed(value.totalUsd) })).sort((a, b) => Number(b.totalUsd) - Number(a.totalUsd)).slice(0, 25),
    capped: records.length === MAX_ROWS * 2,
  };
}
