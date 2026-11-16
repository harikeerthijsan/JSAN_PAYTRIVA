import { NextResponse } from "next/server";
import { PaymentStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/api";

export async function GET(request: Request) {
  const auth = await requirePermission("ap:access");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const dateFrom = url.searchParams.get("invoiceFrom");
  const dateTo = url.searchParams.get("invoiceTo");
  const dueFrom = url.searchParams.get("dueFrom");
  const dueTo = url.searchParams.get("dueTo");
  const validDate = (value: string | null) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime()) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  if ([dateFrom, dateTo, dueFrom, dueTo].some((value) => !validDate(value))) {
    return NextResponse.json({ error: "Date filters must be valid calendar dates." }, { status: 400 });
  }
  const statusValue = url.searchParams.get("status");
  const statuses = Object.values(PaymentStatus);
  const status = statuses.includes(statusValue as PaymentStatus) ? statusValue as PaymentStatus : undefined;
  const baseWhere: Prisma.PaymentRequestWhereInput = {
    status: status ?? { notIn: [PaymentStatus.DRAFT, PaymentStatus.CANCELLED] },
    ...(url.searchParams.get("vendor") ? { vendorName: { contains: url.searchParams.get("vendor")!.slice(0, 100), mode: "insensitive" } } : {}),
    ...(url.searchParams.get("projectId") ? { projectId: url.searchParams.get("projectId")! } : {}),
    ...(url.searchParams.get("currency") ? { currencyCode: url.searchParams.get("currency")!.toUpperCase() } : {}),
    ...(url.searchParams.get("approverId") ? { approvalAssignments: { some: { approverId: url.searchParams.get("approverId")! } } } : {}),
    ...(url.searchParams.get("transactionId") ? { transactionId: { contains: url.searchParams.get("transactionId")!.slice(0, 100), mode: "insensitive" } } : {}),
    ...(dateFrom || dateTo ? { invoiceDate: {
      ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
      ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
    } } : {}),
    ...(dueFrom || dueTo ? { dueDate: {
      ...(dueFrom ? { gte: new Date(`${dueFrom}T00:00:00.000Z`) } : {}),
      ...(dueTo ? { lte: new Date(`${dueTo}T23:59:59.999Z`) } : {}),
    } } : {}),
  };
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekEnd = new Date(today.getTime() + 7 * 86_400_000);
  const [pendingReview, approvedWaiting, dueThisWeek, overdue, returned, clarification, paid, currencies, projects, approvers] = await Promise.all([
    db.paymentRequest.count({ where: { AND: [baseWhere, { status: PaymentStatus.PENDING_REVIEW }] } }),
    db.paymentRequest.count({ where: { AND: [baseWhere, { status: PaymentStatus.APPROVED }] } }),
    db.paymentRequest.count({ where: { AND: [baseWhere, { status: PaymentStatus.APPROVED, dueDate: { gte: today, lt: weekEnd } }] } }),
    db.paymentRequest.count({ where: { AND: [baseWhere, { status: PaymentStatus.APPROVED, dueDate: { lt: today } }] } }),
    db.paymentRequest.count({ where: { AND: [baseWhere, { status: PaymentStatus.RETURNED }] } }),
    db.paymentRequest.count({ where: { AND: [baseWhere, { status: PaymentStatus.NEEDS_INFORMATION }] } }),
    db.paymentConfirmation.aggregate({
      where: { request: { AND: [baseWhere, { status: PaymentStatus.PAID }] } },
      _sum: { amountPaidUsd: true },
    }),
    db.paymentCurrency.findMany({ where: { isActive: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
    db.paymentProject.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { roles: { some: { role: { key: "APPROVER" } } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  return NextResponse.json({
    metrics: {
      pendingReview,
      approvedWaiting,
      dueThisWeek,
      overdue,
      returned,
      clarification,
      totalPaidUsd: paid._sum.amountPaidUsd?.toString() ?? "0",
    },
    filters: { currencies, projects, approvers },
  });
}
