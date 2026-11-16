import "server-only";
import { PaymentStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { loadCurrencyRates } from "@/lib/currency";
import { financialYearRange, type ReportRecord } from "@/lib/report-calcs";

export type ManagementFilters = {
  from: Date | null;
  to: Date | null;
  financialYear: number | null;
  projectId: string | null;
  costCenterId: string | null;
  vendor: string | null;
  currency: string | null;
  approverId: string | null;
  entityId: string | null;
  status: PaymentStatus | null;
};

const MAX_RECORDS = 5000;

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseManagementFilters(url: URL): { filters: ManagementFilters } | { error: string } {
  const get = (key: string) => url.searchParams.get(key)?.trim() || null;
  const fromRaw = get("from");
  const toRaw = get("to");
  if (fromRaw && !validDay(fromRaw)) return { error: "The from date must be a valid calendar date." };
  if (toRaw && !validDay(toRaw)) return { error: "The to date must be a valid calendar date." };

  let financialYear: number | null = null;
  const fyRaw = get("fy");
  if (fyRaw) {
    const year = Number.parseInt(fyRaw, 10);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: "Select a valid financial year." };
    financialYear = year;
  }

  let from = fromRaw ? new Date(`${fromRaw}T00:00:00.000Z`) : null;
  let to = toRaw ? new Date(`${toRaw}T23:59:59.999Z`) : null;
  // An explicit date range wins; otherwise a selected financial year defines the window.
  if (!from && !to && financialYear !== null) {
    const range = financialYearRange(financialYear);
    from = range.from;
    to = range.to;
  }

  const statusRaw = get("status");
  const status = statusRaw && (Object.values(PaymentStatus) as string[]).includes(statusRaw) ? (statusRaw as PaymentStatus) : null;
  if (statusRaw && !status) return { error: "Select a valid payment status." };

  return {
    filters: {
      from,
      to,
      financialYear,
      projectId: get("projectId"),
      costCenterId: get("costCenterId"),
      vendor: get("vendor")?.slice(0, 100) ?? null,
      currency: get("currency")?.toUpperCase() ?? null,
      approverId: get("approverId"),
      entityId: get("entityId"),
      status,
    },
  };
}

export function buildReportWhere(filters: ManagementFilters, dateOverride?: { from: Date | null; to: Date | null }): Prisma.PaymentRequestWhereInput {
  const from = dateOverride ? dateOverride.from : filters.from;
  const to = dateOverride ? dateOverride.to : filters.to;
  return {
    AND: [
      filters.status ? { status: filters.status } : { status: { notIn: [PaymentStatus.DRAFT, PaymentStatus.CANCELLED] } },
      filters.projectId ? { projectId: filters.projectId } : {},
      filters.costCenterId ? { costCenterId: filters.costCenterId } : {},
      filters.vendor ? { vendorName: { contains: filters.vendor, mode: "insensitive" } } : {},
      filters.currency ? { currencyCode: filters.currency } : {},
      filters.approverId ? { approvalAssignments: { some: { approverId: filters.approverId } } } : {},
      filters.entityId ? { billToEntityId: filters.entityId } : {},
      from || to ? { submittedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {},
    ],
  };
}

const recordInclude = {
  project: { select: { name: true } },
  costCenter: { select: { name: true } },
  billToEntity: { select: { name: true } },
  currency: { select: { code: true } },
  paymentConfirmation: { select: { amountPaidUsd: true, actualPaymentDate: true } },
  paymentSchedule: { select: { plannedDate: true, earliestEligibleDate: true, riskStatus: true } },
  approvalAssignments: {
    orderBy: { assignedAt: "desc" as const },
    take: 1,
    include: { approver: { select: { id: true, fullName: true } } },
  },
} satisfies Prisma.PaymentRequestInclude;

function toRecord(item: Prisma.PaymentRequestGetPayload<{ include: typeof recordInclude }>): ReportRecord {
  const assignment = item.approvalAssignments[0] ?? null;
  return {
    id: item.id,
    transactionId: item.transactionId,
    status: item.status,
    vendorName: item.vendorName,
    invoiceNumber: item.invoiceNumber,
    finalValueUsd: item.finalValueUsd,
    invoiceAmount: item.invoiceAmount,
    currencyCode: item.currency?.code ?? item.currencyCode ?? null,
    projectId: item.projectId,
    projectName: item.project?.name ?? null,
    costCenterName: item.costCenter?.name ?? null,
    entityName: item.billToEntity?.name ?? null,
    dueDate: item.dueDate,
    submittedAt: item.submittedAt,
    createdAt: item.createdAt,
    paidUsd: item.paymentConfirmation?.amountPaidUsd ?? null,
    actualPaymentDate: item.paymentConfirmation?.actualPaymentDate ?? null,
    scheduledDate: item.paymentSchedule?.plannedDate ?? null,
    earliestEligibleDate: item.paymentSchedule?.earliestEligibleDate ?? null,
    riskStatus: item.paymentSchedule?.riskStatus ?? null,
    approverId: assignment?.approver.id ?? null,
    approverName: assignment?.approver.fullName ?? null,
    assignedAt: assignment?.assignedAt ?? null,
    assignmentResolvedAt: assignment?.resolvedAt ?? null,
  };
}

export async function fetchReportRecords(where: Prisma.PaymentRequestWhereInput): Promise<{ records: ReportRecord[]; capped: boolean }> {
  const items = await db.paymentRequest.findMany({ where, include: recordInclude, take: MAX_RECORDS, orderBy: { submittedAt: "desc" } });
  return { records: items.map(toRecord), capped: items.length === MAX_RECORDS };
}

export async function loadFilterOptions() {
  const [projects, costCenters, currencies, entities, approvers] = await Promise.all([
    db.paymentProject.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.costCenter.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    loadCurrencyRates(),
    db.paymentEntity.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { roles: { some: { role: { key: "APPROVER" } } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  return { projects, costCenters, currencies, entities, approvers, statuses: Object.values(PaymentStatus) };
}
