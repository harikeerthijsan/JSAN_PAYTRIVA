import { NextResponse } from "next/server";
import { PaymentStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/api";
import { paymentStatusLabel } from "@/lib/payment-requests";

function dateValid(value: string | null): boolean {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime()) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const auth = await requirePermission("ap:access");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const dateFilters = {
    invoiceFrom: url.searchParams.get("invoiceFrom"),
    invoiceTo: url.searchParams.get("invoiceTo"),
    dueFrom: url.searchParams.get("dueFrom"),
    dueTo: url.searchParams.get("dueTo"),
  };
  if (Object.values(dateFilters).some((value) => !dateValid(value))) return NextResponse.json({ error: "Date filters must be valid calendar dates." }, { status: 400 });
  const status = url.searchParams.get("status");
  if (status && status !== "APPROVED") return NextResponse.json({ items: [], total: 0, page: 1, pages: 1, pageSize: 25 });
  const search = url.searchParams.get("search")?.trim().slice(0, 100);
  const sortBy = url.searchParams.get("sort") ?? "dueDate";
  const direction = url.searchParams.get("direction") === "desc" ? "desc" : "asc";
  const orderField = ["dueDate", "vendorName", "transactionId", "invoiceDate", "createdAt"].includes(sortBy) ? sortBy : "dueDate";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));
  const where: Prisma.PaymentRequestWhereInput = {
    status: PaymentStatus.APPROVED,
    ...(url.searchParams.get("vendor") ? { vendorName: { contains: url.searchParams.get("vendor")!.slice(0, 100), mode: "insensitive" } } : {}),
    ...(url.searchParams.get("projectId") ? { projectId: url.searchParams.get("projectId")! } : {}),
    ...(url.searchParams.get("currency") ? { currencyCode: url.searchParams.get("currency")!.toUpperCase() } : {}),
    ...(url.searchParams.get("approverId") ? { approvalAssignments: { some: { approverId: url.searchParams.get("approverId")! } } } : {}),
    ...(url.searchParams.get("transactionId") ? { transactionId: { contains: url.searchParams.get("transactionId")!.slice(0, 100), mode: "insensitive" } } : {}),
    ...(dateFilters.invoiceFrom || dateFilters.invoiceTo ? { invoiceDate: {
      ...(dateFilters.invoiceFrom ? { gte: new Date(`${dateFilters.invoiceFrom}T00:00:00.000Z`) } : {}),
      ...(dateFilters.invoiceTo ? { lte: new Date(`${dateFilters.invoiceTo}T23:59:59.999Z`) } : {}),
    } } : {}),
    ...(dateFilters.dueFrom || dateFilters.dueTo ? { dueDate: {
      ...(dateFilters.dueFrom ? { gte: new Date(`${dateFilters.dueFrom}T00:00:00.000Z`) } : {}),
      ...(dateFilters.dueTo ? { lte: new Date(`${dateFilters.dueTo}T23:59:59.999Z`) } : {}),
    } } : {}),
    ...(search ? { OR: [
      { transactionId: { contains: search, mode: "insensitive" } },
      { vendorName: { contains: search, mode: "insensitive" } },
      { invoiceNumber: { contains: search, mode: "insensitive" } },
      { project: { name: { contains: search, mode: "insensitive" } } },
      { costCenter: { name: { contains: search, mode: "insensitive" } } },
    ] } : {}),
  };
  const exportCsv = url.searchParams.get("export") === "csv";
  const [total, items] = await Promise.all([
    db.paymentRequest.count({ where }),
    db.paymentRequest.findMany({
      where,
      orderBy: { [orderField]: direction },
      ...(exportCsv ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
      include: {
        currency: { select: { code: true } },
        project: { select: { name: true } },
        costCenter: { select: { code: true, name: true } },
        paymentSchedule: { select: { plannedDate: true } },
        approvalAssignments: {
          where: { resolvedAt: null },
          orderBy: { assignedAt: "desc" },
          take: 1,
          include: { approver: { select: { fullName: true } } },
        },
        history: { where: { toStatus: PaymentStatus.APPROVED }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      },
    }),
  ]);
  if (exportCsv) {
    const header = ["Transaction ID", "Vendor", "Invoice Number", "Project", "Cost Center", "Currency", "Invoice Value", "USD Equivalent", "Tax Amount", "Total Payable", "Due Date", "Planned Payment Date", "Approval Date", "Assigned Approver", "Payment Status"];
    const rows = items.map((item) => [
      item.transactionId, item.vendorName, item.invoiceNumber, item.project?.name,
      item.costCenter ? `${item.costCenter.code} - ${item.costCenter.name}` : "",
      item.currency?.code, item.invoiceAmount?.toString(), item.finalValueUsd?.toString(),
      item.taxAmount?.toString(), item.totalPayable?.toString(),
      item.dueDate?.toISOString().slice(0, 10), item.paymentSchedule?.plannedDate?.toISOString().slice(0, 10),
      item.history[0]?.createdAt.toISOString(), item.approvalAssignments[0]?.approver.fullName,
      paymentStatusLabel(item.status),
    ]);
    const content = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="paytriva-approved-payments.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  }
  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      invoiceAmount: item.invoiceAmount?.toString() ?? null,
      finalValueUsd: item.finalValueUsd?.toString() ?? null,
      taxAmount: item.taxAmount?.toString() ?? null,
      totalPayable: item.totalPayable?.toString() ?? null,
      dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null,
      invoiceDate: item.invoiceDate?.toISOString().slice(0, 10) ?? null,
      plannedPaymentDate: item.paymentSchedule?.plannedDate?.toISOString().slice(0, 10) ?? null,
      approvalDate: item.history[0]?.createdAt.toISOString() ?? null,
      assignedApprover: item.approvalAssignments[0]?.approver.fullName ?? "—",
      statusLabel: paymentStatusLabel(item.status),
    })),
    total,
    page,
    pages: Math.ceil(total / pageSize),
    pageSize,
  });
}
