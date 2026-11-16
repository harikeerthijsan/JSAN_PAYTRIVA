import { NextResponse } from "next/server";
import { PaymentStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/api";

export async function GET(request: Request) {
  const auth = await requirePermission("ap:access");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const statusValue = url.searchParams.get("status");
  if (statusValue && statusValue !== "PAID" && statusValue !== "APPROVED") {
    return NextResponse.json({ error: "Select a valid calendar payment status." }, { status: 400 });
  }
  const status = statusValue === "PAID" ? PaymentStatus.PAID : statusValue === "APPROVED" ? PaymentStatus.APPROVED : undefined;
  const search = url.searchParams.get("vendor")?.trim().slice(0, 100);
  const projectId = url.searchParams.get("projectId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const validDate = (value: string | null) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime()) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  if (!validDate(from) || !validDate(to)) return NextResponse.json({ error: "Date filters must be valid calendar dates." }, { status: 400 });
  const dateRange = from || to ? {
    gte: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
    lte: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
  } : undefined;
  const approvedPaymentDateFilter: Prisma.PaymentRequestWhereInput = dateRange
    ? {
        OR: [
          { paymentSchedule: { plannedDate: dateRange } },
          { paymentSchedule: { is: null }, dueDate: dateRange },
        ],
      }
    : {};
  const where: Prisma.PaymentRequestWhereInput = {
    status: status ?? { in: [PaymentStatus.APPROVED, PaymentStatus.PAID] },
    ...(projectId ? { projectId } : {}),
    ...(search ? { vendorName: { contains: search, mode: "insensitive" } } : {}),
    OR: [
      { status: PaymentStatus.APPROVED, ...approvedPaymentDateFilter },
      { status: PaymentStatus.PAID, ...(dateRange ? { paymentConfirmation: { actualPaymentDate: dateRange } } : {}) },
    ],
  };
  const records = await db.paymentRequest.findMany({
    where,
    orderBy: [{ paymentSchedule: { plannedDate: "asc" } }, { dueDate: "asc" }],
    take: 500,
    include: {
      project: { select: { name: true } },
      currency: { select: { code: true } },
      paymentSchedule: { select: { plannedDate: true, remarks: true } },
      paymentConfirmation: { select: { actualPaymentDate: true, amountPaid: true, amountPaidUsd: true, currencyCode: true, paymentReference: true } },
    },
  });
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const weekEnd = new Date(start.getTime() + 7 * 86_400_000);
  return NextResponse.json({
    items: records.map((item) => {
      const paymentDate = item.status === PaymentStatus.PAID
        ? item.paymentConfirmation?.actualPaymentDate
        : item.paymentSchedule?.plannedDate ?? item.dueDate;
      const isPastDue = item.status === PaymentStatus.APPROVED && item.dueDate !== null && item.dueDate < start;
      return {
        id: item.id,
        transactionId: item.transactionId,
        vendorName: item.vendorName,
        invoiceNumber: item.invoiceNumber,
        projectName: item.project?.name ?? "—",
        invoiceAmount: item.invoiceAmount?.toString() ?? null,
        currencyCode: item.currency?.code ?? null,
        dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null,
        plannedPaymentDate: item.paymentSchedule?.plannedDate?.toISOString().slice(0, 10) ?? null,
        actualPaymentDate: item.paymentConfirmation?.actualPaymentDate.toISOString().slice(0, 10) ?? null,
        paymentDate: paymentDate?.toISOString().slice(0, 10) ?? null,
        status: item.status,
        statusLabel: item.status === PaymentStatus.PAID ? "Completed" : isPastDue ? "Overdue" : "Upcoming",
        isDueThisWeek: item.status === PaymentStatus.APPROVED && Boolean(item.dueDate && item.dueDate >= start && item.dueDate < weekEnd),
        isOverdue: isPastDue,
        isWednesday: item.paymentSchedule?.plannedDate?.getUTCDay() === 3,
        actualPaidAmount: item.paymentConfirmation?.amountPaid.toString() ?? null,
        paidCurrencyCode: item.paymentConfirmation?.currencyCode ?? null,
        paymentReference: item.paymentConfirmation?.paymentReference ?? null,
      };
    }),
    capped: records.length === 500,
  });
}
