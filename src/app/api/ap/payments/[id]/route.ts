import { NextResponse } from "next/server";
import { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { jsonError, requirePermission } from "@/lib/api";
import { redactPaymentAccount } from "@/lib/payment-corrections";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requirePermission("ap:access");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const item = await db.paymentRequest.findUnique({
    where: { id, status: { in: [PaymentStatus.APPROVED, PaymentStatus.PAID] } },
    include: {
      paymentConfirmation: {
        include: {
          currency: { select: { code: true, name: true, symbol: true } },
          processedBy: { select: { id: true, fullName: true } },
          proofDocument: { select: { id: true, filename: true, mimeType: true, sizeBytes: true } },
          corrections: { orderBy: { createdAt: "asc" }, include: { actor: { select: { fullName: true } } } },
        },
      },
    },
  });
  if (!item) return jsonError("Eligible payment record not found.", 404);
  return NextResponse.json({
    id: item.id,
    transactionId: item.transactionId,
    status: item.status,
    paymentConfirmation: item.paymentConfirmation ? {
      ...item.paymentConfirmation,
      amountPaid: item.paymentConfirmation.amountPaid.toString(),
      amountPaidUsd: item.paymentConfirmation.amountPaidUsd.toString(),
      exchangeRate: item.paymentConfirmation.exchangeRate.toString(),
      paymentAccount: auth.user.permissions.includes("payments:read_payment_account")
        ? item.paymentConfirmation.paymentAccount
        : "Restricted",
      actualPaymentDate: item.paymentConfirmation.actualPaymentDate.toISOString().slice(0, 10),
      corrections: item.paymentConfirmation.corrections.map((correction) => ({
        ...correction,
        previousValues: redactPaymentAccount(correction.previousValues, auth.user.permissions.includes("payments:read_payment_account")),
        correctedValues: redactPaymentAccount(correction.correctedValues, auth.user.permissions.includes("payments:read_payment_account")),
        actorName: correction.actor.fullName,
      })),
    } : null,
  });
}
