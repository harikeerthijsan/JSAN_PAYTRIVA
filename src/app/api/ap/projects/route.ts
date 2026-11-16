import { NextResponse } from "next/server";
import { PaymentStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/api";

export async function GET(request: Request) {
  const auth = await requirePermission("ap:access");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const vendor = url.searchParams.get("vendor")?.trim().slice(0, 100);
  const statusValue = url.searchParams.get("status");
  const reportableStatuses: PaymentStatus[] = Object.values(PaymentStatus).filter((value) => value !== PaymentStatus.DRAFT && value !== PaymentStatus.CANCELLED);
  if (statusValue && !reportableStatuses.includes(statusValue as PaymentStatus)) {
    return NextResponse.json({ error: "Select a valid submitted payment status." }, { status: 400 });
  }
  const status = statusValue ? statusValue as PaymentStatus : undefined;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const validDate = (value: string | null) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime()) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  if (!validDate(from) || !validDate(to)) return NextResponse.json({ error: "Date filters must be valid calendar dates." }, { status: 400 });
  const where: Prisma.PaymentRequestWhereInput = {
    status: status ? status : { notIn: [PaymentStatus.DRAFT, PaymentStatus.CANCELLED] },
    ...(projectId ? { projectId } : {}),
    ...(vendor ? { vendorName: { contains: vendor, mode: "insensitive" } } : {}),
    ...(from || to ? { invoiceDate: {
      ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
    } } : {}),
  };
  const requests = await db.paymentRequest.findMany({
    where,
    select: {
      projectId: true,
      project: { select: { name: true } },
      status: true,
      finalValueUsd: true,
      dueDate: true,
      paymentConfirmation: { select: { amountPaidUsd: true } },
    },
  });
  const groups = new Map<string, {
    projectName: string;
    requested: Prisma.Decimal;
    approved: Prisma.Decimal;
    paid: Prisma.Decimal;
    invoices: number;
    pending: number;
    overdue: number;
  }>();
  const zero = () => new Prisma.Decimal(0);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const requestItem of requests) {
    const key = requestItem.projectId ?? "unassigned";
    const entry = groups.get(key) ?? {
      projectName: requestItem.project?.name ?? "Unassigned",
      requested: zero(),
      approved: zero(),
      paid: zero(),
      invoices: 0,
      pending: 0,
      overdue: 0,
    };
    const amount = requestItem.finalValueUsd ?? zero();
    entry.requested = entry.requested.plus(amount);
    entry.invoices += 1;
    if (requestItem.status === PaymentStatus.APPROVED || requestItem.status === PaymentStatus.PAID) entry.approved = entry.approved.plus(amount);
    if (requestItem.status === PaymentStatus.PAID) entry.paid = entry.paid.plus(requestItem.paymentConfirmation?.amountPaidUsd ?? zero());
    if (requestItem.status === PaymentStatus.APPROVED) {
      entry.pending += 1;
      if (requestItem.dueDate && requestItem.dueDate < today) entry.overdue += 1;
    }
    groups.set(key, entry);
  }
  const items = [...groups.entries()].map(([id, entry]) => ({
    projectId: id === "unassigned" ? null : id,
    projectName: entry.projectName,
    totalRequestedUsd: entry.requested.toFixed(2),
    totalApprovedUsd: entry.approved.toFixed(2),
    totalPaidUsd: entry.paid.toFixed(2),
    outstandingUsd: entry.approved.minus(entry.paid).toFixed(2),
    invoiceCount: entry.invoices,
    pendingPayments: entry.pending,
    overduePayments: entry.overdue,
  })).sort((left, right) => left.projectName.localeCompare(right.projectName));
  return NextResponse.json({ items, totalProjects: items.length });
}
