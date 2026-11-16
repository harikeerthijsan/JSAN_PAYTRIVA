import { NextResponse } from "next/server";
import { z } from "zod";
import { PaymentStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { jsonError, requireUser } from "@/lib/api";
import { auditContext, recordAudit } from "@/lib/audit";

const schema = z.object({
  reason: z.string().trim().min(5).max(2000),
  amountPaid: z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/),
  currencyCode: z.string().regex(/^[A-Za-z]{3}$/),
  actualPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentReference: z.string().trim().min(2).max(120),
  paymentMethod: z.string().trim().min(2).max(80),
  paymentAccount: z.string().trim().min(2).max(180),
  remarks: z.string().trim().max(2000).optional(),
});
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (!auth.user.permissions.includes("ap:access") || !auth.user.permissions.includes("payments:correct")) {
    return jsonError("Authorized AP payment-correction permission is required.", 403);
  }
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Correction details must be valid JSON.", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Provide every payment detail and a correction reason.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  const amountPaid = new Prisma.Decimal(input.amountPaid);
  if (amountPaid.lte(0)) return jsonError("Corrected amount paid must be greater than zero.", 400);
  const paymentDate = new Date(`${input.actualPaymentDate}T00:00:00.000Z`);
  if (!Number.isFinite(paymentDate.getTime()) || paymentDate.toISOString().slice(0, 10) !== input.actualPaymentDate || paymentDate.getTime() > Date.now()) {
    return jsonError("Actual payment date must be a valid date that is not in the future.", 400);
  }
  const currencyCode = input.currencyCode.toUpperCase();
  const { id } = await context.params;
  try {
    const outcome = await db.$transaction(async (tx) => {
      const requestItem = await tx.paymentRequest.findUnique({
        where: { id },
        select: {
          id: true,
          transactionId: true,
          status: true,
          paymentConfirmation: true,
        },
      });
      if (!requestItem) return { response: jsonError("Payment request not found.", 404) };
      if (requestItem.status !== PaymentStatus.PAID || !requestItem.paymentConfirmation) {
        return { response: jsonError("Only confirmed payments can be corrected.", 409) };
      }
      const currency = await tx.paymentCurrency.findFirst({ where: { code: currencyCode, isActive: true } });
      if (!currency) return { response: jsonError("The corrected payment currency is not active.", 400) };
      const rate = currency.code === "USD"
        ? { usdPerUnit: new Prisma.Decimal(1), source: "USD base currency" }
        : await tx.currencyExchangeRate.findFirst({
            where: { currencyCode, effectiveAt: { lte: paymentDate } },
            orderBy: { effectiveAt: "desc" },
          });
      if (!rate) return { response: jsonError("No exchange rate is configured for the corrected currency and payment date.", 409) };
      const before = requestItem.paymentConfirmation;
      const previousValues = {
        amountPaid: before.amountPaid.toString(),
        currencyCode: before.currencyCode,
        amountPaidUsd: before.amountPaidUsd.toString(),
        exchangeRate: before.exchangeRate.toString(),
        exchangeRateSource: before.exchangeRateSource,
        actualPaymentDate: before.actualPaymentDate.toISOString(),
        paymentReference: before.paymentReference,
        paymentMethod: before.paymentMethod,
        paymentAccount: before.paymentAccount,
        remarks: before.remarks,
      };
      const correctedValues = {
        amountPaid: amountPaid.toString(),
        currencyCode,
        amountPaidUsd: amountPaid.mul(rate.usdPerUnit).toString(),
        exchangeRate: rate.usdPerUnit.toString(),
        exchangeRateSource: rate.source,
        actualPaymentDate: paymentDate.toISOString(),
        paymentReference: input.paymentReference,
        paymentMethod: input.paymentMethod,
        paymentAccount: input.paymentAccount,
        remarks: input.remarks || null,
      };
      const confirmation = await tx.paymentConfirmation.update({
        where: { id: before.id },
        data: {
          amountPaid,
          currencyCode,
          amountPaidUsd: amountPaid.mul(rate.usdPerUnit),
          exchangeRate: rate.usdPerUnit,
          exchangeRateSource: rate.source,
          actualPaymentDate: paymentDate,
          paymentReference: input.paymentReference,
          paymentMethod: input.paymentMethod,
          paymentAccount: input.paymentAccount,
          remarks: input.remarks || null,
        },
        select: { id: true, paymentReference: true, actualPaymentDate: true, amountPaid: true, currencyCode: true },
      });
      await tx.paymentCorrection.create({
        data: {
          requestId: id,
          confirmationId: before.id,
          actorId: auth.user.id,
          reason: input.reason,
          previousValues,
          correctedValues,
        },
      });
      await tx.paymentRequestHistory.create({
        data: {
          requestId: id,
          actorId: auth.user.id,
          action: "PAYMENT_CORRECTED",
          fromStatus: PaymentStatus.PAID,
          toStatus: PaymentStatus.PAID,
          description: input.reason,
        },
      });
      const { ip, userAgent } = auditContext(request);
      await recordAudit(tx, {
        actorId: auth.user.id, actorName: auth.user.fullName, action: "PAYMENT_CORRECTED",
        entityType: "PAYMENT_REQUEST", entityId: id, summary: input.reason,
        previousValue: previousValues, newValue: correctedValues, ip, userAgent,
      });
      return { transactionId: requestItem.transactionId, confirmation };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if ("response" in outcome) return outcome.response;
    return NextResponse.json(outcome);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return jsonError("That payment reference is already recorded.", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return jsonError("Payment details changed while applying this correction. Refresh and retry.", 409);
    console.error("Payment correction failed.", error);
    return jsonError("The payment correction could not be saved.", 500);
  }
}
