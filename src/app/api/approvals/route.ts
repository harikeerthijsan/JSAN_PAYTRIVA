import { NextResponse } from "next/server";
import { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/api";

const trackedStatuses = [PaymentStatus.PENDING_APPROVAL, PaymentStatus.APPROVED, PaymentStatus.REJECTED, PaymentStatus.NEEDS_INFORMATION];

export async function GET() {
  const auth = await requirePermission("approvals:access");
  if ("response" in auth) return auth.response;
  const isAdmin = auth.user.permissions.includes("platform:admin");
  const matchingAssignments = isAdmin ? undefined : { approverId: auth.user.id };
  const records = await db.paymentRequest.findMany({
    where: {
      status: { in: trackedStatuses },
      approvalAssignments: { some: matchingAssignments ?? {} },
    },
    orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
    take: 200,
    include: {
      currency: { select: { code: true, symbol: true } },
      project: { select: { name: true } },
      requestor: { select: { fullName: true } },
      approvalAssignments: {
        where: matchingAssignments,
        orderBy: { assignedAt: "desc" },
        take: 1,
        include: { approver: { select: { fullName: true } }, threshold: { select: { label: true } } },
      },
    },
  });
  const now = Date.now();
  const items = records.map((item) => {
    const assignment = item.approvalAssignments[0];
    return {
      id: item.id,
      transactionId: item.transactionId,
      vendorName: item.vendorName,
      invoiceNumber: item.invoiceNumber,
      projectName: item.project?.name ?? "—",
      invoiceAmount: item.invoiceAmount?.toString() ?? null,
      currencyCode: item.currency?.code ?? null,
      finalValueUsd: item.finalValueUsd?.toString() ?? null,
      dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null,
      submittedAt: item.submittedAt?.toISOString() ?? null,
      requestorName: item.requestor.fullName,
      status: item.status,
      assignedAt: assignment?.assignedAt.toISOString() ?? null,
      approverName: assignment?.approver.fullName ?? null,
      thresholdLabel: assignment?.threshold.label ?? null,
      ageHours: assignment ? Math.max(0, (now - assignment.assignedAt.getTime()) / 3_600_000) : 0,
    };
  });
  const pending = items.filter((item) => item.status === PaymentStatus.PENDING_APPROVAL);
  return NextResponse.json({
    items,
    stats: {
      pending: pending.length,
      approved: items.filter((item) => item.status === PaymentStatus.APPROVED).length,
      rejected: items.filter((item) => item.status === PaymentStatus.REJECTED).length,
      clarification: items.filter((item) => item.status === PaymentStatus.NEEDS_INFORMATION).length,
      pendingValueUsd: pending.reduce((total, item) => total + Number(item.finalValueUsd ?? 0), 0).toFixed(2),
      averageAgeHours: pending.length ? pending.reduce((total, item) => total + item.ageHours, 0) / pending.length : 0,
      capped: records.length === 200,
    },
  });
}
