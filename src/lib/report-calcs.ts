// Pure management-report calculations for PAYTRIVA Phase 7.
//
// No database or server-only imports so this can be unit tested and reused. Every monetary
// value is kept in the USD reporting currency as a Prisma.Decimal to avoid mixing currencies
// and to preserve precision. Callers convert each transaction to USD before aggregation.
import { Prisma } from "@/generated/prisma/client";
import { derivePaymentCategory, toIsoDay, toUtcDateOnly } from "@/lib/payment-scheduling";

export type MoneyInput = Prisma.Decimal | string | number | null | undefined;
const D = (value: MoneyInput) => new Prisma.Decimal(value ?? 0);

export const REPORT_STATUSES = [
  "PENDING_REVIEW", "UNDER_REVIEW", "PENDING_APPROVAL", "RETURNED",
  "NEEDS_INFORMATION", "APPROVED", "REJECTED", "PAID",
] as const;
export type ReportStatus = typeof REPORT_STATUSES[number];

// Statuses that represent unpaid work still inside the AP pipeline.
const OPEN_AP_STATUSES = new Set(["PENDING_REVIEW", "UNDER_REVIEW", "PENDING_APPROVAL", "RETURNED", "NEEDS_INFORMATION", "APPROVED"]);

export type ReportRecord = {
  id: string;
  transactionId: string;
  status: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  finalValueUsd: MoneyInput;
  invoiceAmount: MoneyInput;
  currencyCode: string | null;
  projectId: string | null;
  projectName: string | null;
  costCenterName: string | null;
  entityName: string | null;
  dueDate: Date | null;
  submittedAt: Date | null;
  createdAt: Date;
  paidUsd: MoneyInput;
  actualPaymentDate: Date | null;
  scheduledDate: Date | null;
  earliestEligibleDate: Date | null;
  riskStatus: string | null;
  approverId: string | null;
  approverName: string | null;
  assignedAt: Date | null;
  assignmentResolvedAt: Date | null;
};

/** JSAN financial year runs 1 April to 31 March. */
export function financialYearRange(year: number): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(year, 3, 1, 0, 0, 0, 0)),
    to: new Date(Date.UTC(year + 1, 2, 31, 23, 59, 59, 999)),
  };
}

export type AgingBucket = "0-8" | "8-24" | "24-48" | "48+";
export function agingBucket(hours: number): AgingBucket {
  if (hours < 8) return "0-8";
  if (hours < 24) return "8-24";
  if (hours < 48) return "24-48";
  return "48+";
}

/** Immediately preceding period of equal length, for KPI comparison. */
export function previousPeriod(from: Date, to: Date): { from: Date; to: Date } {
  const span = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - span - 1), to: new Date(from.getTime() - 1) };
}

function category(record: ReportRecord, now: Date) {
  return derivePaymentCategory({
    isPaid: record.status === "PAID",
    isApproved: record.status === "APPROVED",
    scheduledPaymentDate: record.scheduledDate,
    earliestEligibleDate: record.earliestEligibleDate,
    dueDate: record.dueDate,
    riskStatus: record.riskStatus === "AT_RISK" ? "AT_RISK" : record.riskStatus === "ON_TRACK" ? "ON_TRACK" : null,
    now,
  });
}

function utcDaysBetween(a: Date, b: Date): number {
  return Math.floor((toUtcDateOnly(b).getTime() - toUtcDateOnly(a).getTime()) / 86_400_000);
}

export type KpiTotals = {
  totalOpenAp: { usd: string; count: number };
  dueThisWeek: { usd: string; count: number };
  overdue: { usd: string; count: number };
  totalPaid: { usd: string; count: number };
  pendingApprovals: { usd: string; count: number };
  approvedWaiting: { usd: string; count: number };
  totalOutstanding: { usd: string; count: number };
  totalRequests: { usd: string; count: number };
};

export function computeKpis(records: ReportRecord[], now: Date): KpiTotals {
  const z = () => new Prisma.Decimal(0);
  const acc = {
    openAp: { usd: z(), count: 0 },
    dueWeek: { usd: z(), count: 0 },
    overdue: { usd: z(), count: 0 },
    paid: { usd: z(), count: 0 },
    pending: { usd: z(), count: 0 },
    approved: { usd: z(), count: 0 },
    outstanding: { usd: z(), count: 0 },
    all: { usd: z(), count: 0 },
  };
  for (const record of records) {
    const value = D(record.finalValueUsd);
    acc.all.usd = acc.all.usd.plus(value);
    acc.all.count += 1;
    if (OPEN_AP_STATUSES.has(record.status)) { acc.openAp.usd = acc.openAp.usd.plus(value); acc.openAp.count += 1; }
    if (record.status === "PENDING_APPROVAL") { acc.pending.usd = acc.pending.usd.plus(value); acc.pending.count += 1; }
    if (record.status === "APPROVED") {
      acc.approved.usd = acc.approved.usd.plus(value); acc.approved.count += 1;
      acc.outstanding.usd = acc.outstanding.usd.plus(value); acc.outstanding.count += 1;
      const cat = category(record, now);
      if (cat === "OVERDUE") { acc.overdue.usd = acc.overdue.usd.plus(value); acc.overdue.count += 1; }
      else if (cat === "DUE_THIS_WEEK") { acc.dueWeek.usd = acc.dueWeek.usd.plus(value); acc.dueWeek.count += 1; }
    }
    if (record.status === "PAID") { acc.paid.usd = acc.paid.usd.plus(D(record.paidUsd)); acc.paid.count += 1; }
  }
  const fmt = (slot: { usd: Prisma.Decimal; count: number }) => ({ usd: slot.usd.toFixed(2), count: slot.count });
  return {
    totalOpenAp: fmt(acc.openAp),
    dueThisWeek: fmt(acc.dueWeek),
    overdue: fmt(acc.overdue),
    totalPaid: fmt(acc.paid),
    pendingApprovals: fmt(acc.pending),
    approvedWaiting: fmt(acc.approved),
    totalOutstanding: fmt(acc.outstanding),
    totalRequests: fmt(acc.all),
  };
}

export function computeStatusDistribution(records: ReportRecord[]) {
  const counts = Object.fromEntries(REPORT_STATUSES.map((status) => [status, 0])) as Record<ReportStatus, number>;
  for (const record of records) {
    if ((REPORT_STATUSES as readonly string[]).includes(record.status)) counts[record.status as ReportStatus] += 1;
  }
  return REPORT_STATUSES.map((status) => ({ status, count: counts[status] }));
}

/** Monthly payment trends using real timestamps: submission, approval resolution, and payment date. */
export function computeTrends(records: ReportRecord[], now: Date, monthsBack = 12) {
  const months: string[] = [];
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let index = monthsBack - 1; index >= 0; index -= 1) {
    months.push(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - index, 1)).toISOString().slice(0, 7));
  }
  const empty = () => ({ requests: 0, approvedCount: 0, approvedUsd: new Prisma.Decimal(0), completedCount: 0, completedUsd: new Prisma.Decimal(0) });
  const map = new Map(months.map((month) => [month, empty()]));
  for (const record of records) {
    if (record.submittedAt) {
      const key = record.submittedAt.toISOString().slice(0, 7);
      const slot = map.get(key);
      if (slot) slot.requests += 1;
    }
    if ((record.status === "APPROVED" || record.status === "PAID") && record.assignmentResolvedAt) {
      const key = record.assignmentResolvedAt.toISOString().slice(0, 7);
      const slot = map.get(key);
      if (slot) { slot.approvedCount += 1; slot.approvedUsd = slot.approvedUsd.plus(D(record.finalValueUsd)); }
    }
    if (record.status === "PAID" && record.actualPaymentDate) {
      const key = record.actualPaymentDate.toISOString().slice(0, 7);
      const slot = map.get(key);
      if (slot) { slot.completedCount += 1; slot.completedUsd = slot.completedUsd.plus(D(record.paidUsd)); }
    }
  }
  return months.map((month) => {
    const slot = map.get(month)!;
    return {
      month,
      requests: slot.requests,
      approvedCount: slot.approvedCount,
      approvedUsd: slot.approvedUsd.toFixed(2),
      completedCount: slot.completedCount,
      completedUsd: slot.completedUsd.toFixed(2),
    };
  });
}

export function computeCurrencyReport(records: ReportRecord[]) {
  const map = new Map<string, { count: number; original: Prisma.Decimal; usd: Prisma.Decimal }>();
  for (const record of records) {
    const code = record.currencyCode ?? "—";
    const entry = map.get(code) ?? { count: 0, original: new Prisma.Decimal(0), usd: new Prisma.Decimal(0) };
    entry.count += 1;
    entry.original = entry.original.plus(D(record.invoiceAmount));
    entry.usd = entry.usd.plus(D(record.finalValueUsd));
    map.set(code, entry);
  }
  return [...map.entries()]
    .map(([code, entry]) => ({ code, count: entry.count, totalOriginal: entry.original.toFixed(2), totalUsd: entry.usd.toFixed(2) }))
    .sort((a, b) => Number(b.totalUsd) - Number(a.totalUsd));
}

export function computeProjectReport(records: ReportRecord[], now: Date) {
  const map = new Map<string, {
    projectName: string; costCenters: Set<string>; invoices: number;
    requested: Prisma.Decimal; approved: Prisma.Decimal; paid: Prisma.Decimal; overdue: Prisma.Decimal;
  }>();
  for (const record of records) {
    const key = record.projectId ?? "unassigned";
    const entry = map.get(key) ?? {
      projectName: record.projectName ?? "Unassigned", costCenters: new Set<string>(), invoices: 0,
      requested: new Prisma.Decimal(0), approved: new Prisma.Decimal(0), paid: new Prisma.Decimal(0), overdue: new Prisma.Decimal(0),
    };
    const value = D(record.finalValueUsd);
    entry.invoices += 1;
    entry.requested = entry.requested.plus(value);
    if (record.costCenterName) entry.costCenters.add(record.costCenterName);
    if (record.status === "APPROVED" || record.status === "PAID") entry.approved = entry.approved.plus(value);
    if (record.status === "PAID") entry.paid = entry.paid.plus(D(record.paidUsd));
    if (record.status === "APPROVED" && category(record, now) === "OVERDUE") entry.overdue = entry.overdue.plus(value);
    map.set(key, entry);
  }
  return [...map.entries()].map(([id, entry]) => ({
    projectId: id === "unassigned" ? null : id,
    projectName: entry.projectName,
    costCenter: entry.costCenters.size === 0 ? "—" : entry.costCenters.size === 1 ? [...entry.costCenters][0] : "Multiple",
    totalInvoices: entry.invoices,
    totalRequestedUsd: entry.requested.toFixed(2),
    totalApprovedUsd: entry.approved.toFixed(2),
    totalPaidUsd: entry.paid.toFixed(2),
    outstandingUsd: entry.approved.minus(entry.paid).toFixed(2),
    overdueUsd: entry.overdue.toFixed(2),
  })).sort((a, b) => Number(b.totalRequestedUsd) - Number(a.totalRequestedUsd));
}

export function computeVendorReport(records: ReportRecord[], now: Date) {
  const map = new Map<string, {
    invoices: number; invoiceValue: Prisma.Decimal; paid: Prisma.Decimal; pending: Prisma.Decimal; overdue: Prisma.Decimal; lastPayment: Date | null;
  }>();
  for (const record of records) {
    const key = record.vendorName?.trim() || "Unknown vendor";
    const entry = map.get(key) ?? { invoices: 0, invoiceValue: new Prisma.Decimal(0), paid: new Prisma.Decimal(0), pending: new Prisma.Decimal(0), overdue: new Prisma.Decimal(0), lastPayment: null as Date | null };
    const value = D(record.finalValueUsd);
    entry.invoices += 1;
    entry.invoiceValue = entry.invoiceValue.plus(value);
    if (record.status === "PAID") {
      entry.paid = entry.paid.plus(D(record.paidUsd));
      if (record.actualPaymentDate && (!entry.lastPayment || record.actualPaymentDate > entry.lastPayment)) entry.lastPayment = record.actualPaymentDate;
    }
    if (record.status === "APPROVED") {
      entry.pending = entry.pending.plus(value);
      if (category(record, now) === "OVERDUE") entry.overdue = entry.overdue.plus(value);
    }
    map.set(key, entry);
  }
  return [...map.entries()].map(([vendor, entry]) => ({
    vendorName: vendor,
    totalInvoices: entry.invoices,
    totalInvoiceValueUsd: entry.invoiceValue.toFixed(2),
    totalPaidUsd: entry.paid.toFixed(2),
    pendingPaymentsUsd: entry.pending.toFixed(2),
    overduePaymentsUsd: entry.overdue.toFixed(2),
    lastPaymentDate: entry.lastPayment ? toIsoDay(entry.lastPayment) : null,
  })).sort((a, b) => Number(b.totalInvoiceValueUsd) - Number(a.totalInvoiceValueUsd));
}

export function computeAging(records: ReportRecord[], now: Date) {
  const buckets: Record<AgingBucket, number> = { "0-8": 0, "8-24": 0, "24-48": 0, "48+": 0 };
  const rows = records
    .filter((record) => record.status === "PENDING_APPROVAL" && record.assignedAt && !record.assignmentResolvedAt)
    .map((record) => {
      const hours = Math.max(0, (now.getTime() - record.assignedAt!.getTime()) / 3_600_000);
      const bucket = agingBucket(hours);
      buckets[bucket] += 1;
      return {
        id: record.id,
        transactionId: record.transactionId,
        vendorName: record.vendorName,
        invoiceNumber: record.invoiceNumber,
        projectName: record.projectName ?? "—",
        invoiceValueUsd: D(record.finalValueUsd).toFixed(2),
        approverName: record.approverName,
        submittedAt: record.submittedAt ? record.submittedAt.toISOString() : null,
        pendingSince: record.assignedAt!.toISOString(),
        pendingHours: Math.round(hours * 10) / 10,
        bucket,
        delayed: bucket === "48+",
        status: record.status,
      };
    })
    .sort((a, b) => b.pendingHours - a.pendingHours);
  return { rows, buckets };
}

export function computeOverdue(records: ReportRecord[], now: Date) {
  const rows = records
    .filter((record) => record.status === "APPROVED" && category(record, now) === "OVERDUE")
    .map((record) => ({
      id: record.id,
      transactionId: record.transactionId,
      vendorName: record.vendorName,
      projectName: record.projectName ?? "—",
      invoiceValueUsd: D(record.finalValueUsd).toFixed(2),
      dueDate: record.dueDate ? toIsoDay(record.dueDate) : null,
      daysOverdue: record.dueDate ? utcDaysBetween(record.dueDate, now) : 0,
      status: record.status,
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
  const totalUsd = rows.reduce((total, row) => total.plus(row.invoiceValueUsd), new Prisma.Decimal(0));
  return { rows, count: rows.length, totalUsd: totalUsd.toFixed(2) };
}

export function computeUpcoming(records: ReportRecord[], now: Date) {
  const today = toUtcDateOnly(now);
  const rows = records
    .filter((record) => record.status === "APPROVED" && record.scheduledDate && toUtcDateOnly(record.scheduledDate).getTime() >= today.getTime())
    .map((record) => ({
      id: record.id,
      transactionId: record.transactionId,
      vendorName: record.vendorName,
      projectName: record.projectName ?? "—",
      scheduledDate: toIsoDay(record.scheduledDate!),
      isWednesday: toUtcDateOnly(record.scheduledDate!).getUTCDay() === 3,
      invoiceValueUsd: D(record.finalValueUsd).toFixed(2),
    }))
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const totalUsd = rows.reduce((total, row) => total.plus(row.invoiceValueUsd), new Prisma.Decimal(0));
  return { rows, count: rows.length, totalUsd: totalUsd.toFixed(2) };
}
