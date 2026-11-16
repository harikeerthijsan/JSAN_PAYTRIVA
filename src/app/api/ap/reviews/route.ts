import { NextResponse } from "next/server";
import { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/api";

export async function GET(request: Request) {
  const auth = await requirePermission("ap:access");
  if ("response" in auth) return auth.response;
  const requestedStatus = new URL(request.url).searchParams.get("status");
  const statuses: PaymentStatus[] = [PaymentStatus.PENDING_REVIEW, PaymentStatus.UNDER_REVIEW, PaymentStatus.RETURNED, PaymentStatus.NEEDS_INFORMATION];
  if (requestedStatus && !statuses.includes(requestedStatus as PaymentStatus)) {
    return NextResponse.json({ error: "Select a valid AP review status." }, { status: 400 });
  }
  const reviewWhere = { status: requestedStatus ? requestedStatus as PaymentStatus : { in: statuses } };
  const [items, readyForPayment, readyCount] = await Promise.all([
    db.paymentRequest.findMany({
    where: reviewWhere,
    orderBy: [{ status: "asc" }, { submittedAt: "asc" }],
    take: 200,
    select: {
      id: true,
      transactionId: true,
      vendorName: true,
      invoiceNumber: true,
      invoiceAmount: true,
      currency: { select: { code: true } },
      finalValueUsd: true,
      dueDate: true,
      submittedAt: true,
      status: true,
      requestor: { select: { fullName: true } },
      project: { select: { name: true } },
    },
    }),
    db.paymentRequest.findMany({
      where: { status: PaymentStatus.APPROVED },
      orderBy: { updatedAt: "asc" },
      take: 100,
      select: {
        id: true,
        transactionId: true,
        vendorName: true,
        invoiceNumber: true,
        invoiceAmount: true,
        currency: { select: { code: true } },
        finalValueUsd: true,
        dueDate: true,
        submittedAt: true,
        status: true,
        requestor: { select: { fullName: true } },
        project: { select: { name: true } },
      },
    }),
    db.paymentRequest.count({ where: { status: PaymentStatus.APPROVED } }),
  ]);
  const normalize = (item: typeof items[number]) => ({
    ...item,
    invoiceAmount: item.invoiceAmount?.toString() ?? null,
    finalValueUsd: item.finalValueUsd?.toString() ?? null,
    dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null,
    submittedAt: item.submittedAt?.toISOString() ?? null,
  });
  return NextResponse.json({
    items: items.map(normalize),
    readyForPayment: requestedStatus ? [] : readyForPayment.map(normalize),
    readyCount: requestedStatus ? 0 : readyCount,
  });
}
