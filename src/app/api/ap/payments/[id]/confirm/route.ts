import { extname } from "node:path";
import { NextResponse } from "next/server";
import { Prisma, PaymentStatus, DocumentKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { jsonError, requirePermission } from "@/lib/api";
import { validatePaymentProof } from "@/lib/payment-proof-validation";
import { MAX_DOCUMENT_BYTES, removePrivateDocument, savePrivateDocument } from "@/lib/payment-storage";
import { notificationEventKey, queueNotification } from "@/lib/notifications";
import { auditContext, recordAudit } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string }> };

function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requirePermission("ap:access");
  if ("response" in auth) return auth.response;
  let form: FormData;
  try { form = await request.formData(); } catch { return jsonError("Payment confirmation form could not be read.", 400); }
  const raw = {
    currencyCode: form.get("currencyCode"),
    actualPaymentDate: form.get("actualPaymentDate"),
    paymentReference: form.get("paymentReference"),
    paymentMethod: form.get("paymentMethod"),
    paymentAccount: form.get("paymentAccount"),
    remarks: form.get("remarks"),
  };
  const amountPaidValue = form.get("amountPaid");
  const isString = (value: FormDataEntryValue | null): value is string => typeof value === "string";
  if (!isString(amountPaidValue) || !isString(raw.currencyCode) || !isString(raw.actualPaymentDate) ||
      !isString(raw.paymentReference) || !isString(raw.paymentMethod) || !isString(raw.paymentAccount) ||
      raw.remarks !== null && !isString(raw.remarks)) return jsonError("All required payment confirmation fields must be provided.", 400);
  const amountPattern = /^\d{1,14}(?:\.\d{1,6})?$/;
  if (!amountPattern.test(amountPaidValue) || new Prisma.Decimal(amountPaidValue).lte(0)) return jsonError("Amount paid must be a positive number with up to 6 decimal places.", 400);
  const currencyCode = raw.currencyCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) return jsonError("Select a valid payment currency.", 400);
  if (!isCalendarDate(raw.actualPaymentDate)) return jsonError("Actual payment date must be a valid calendar date.", 400);
  const actualPaymentDate = new Date(`${raw.actualPaymentDate}T00:00:00.000Z`);
  if (actualPaymentDate.getTime() > Date.now()) return jsonError("Actual payment date cannot be in the future.", 400);
  const paymentReference = raw.paymentReference.trim();
  const paymentMethod = raw.paymentMethod.trim();
  const paymentAccount = raw.paymentAccount.trim();
  if (paymentReference.length < 2 || paymentReference.length > 120 || paymentMethod.length < 2 || paymentMethod.length > 80 ||
      paymentAccount.length < 2 || paymentAccount.length > 180) return jsonError("Provide valid payment reference, method, and payment account details.", 400);
  const remarks = isString(raw.remarks) ? raw.remarks.trim().slice(0, 2000) : "";
  const proof = form.get("proof");
  if (!(proof instanceof File) || proof.size < 1 || proof.size > MAX_DOCUMENT_BYTES) {
    return jsonError(`Payment proof is required and must be no larger than ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.`, 400);
  }
  const bytes = new Uint8Array(await proof.arrayBuffer());
  const mimeType = validatePaymentProof(proof.name, proof.type || "application/octet-stream", bytes);
  if (!mimeType) return jsonError("Payment proof must be a valid PDF, JPG/JPEG, or PNG file.", 400);
  const { id } = await context.params;
  let storageKey: string | null = null;
  try {
    const requestInfo = await db.paymentRequest.findUnique({
      where: { id },
      select: { id: true, transactionId: true, requestorId: true, status: true },
    });
    if (!requestInfo) return jsonError("Payment request not found.", 404);
    if (requestInfo.status !== PaymentStatus.APPROVED) return jsonError("Only approved, unpaid requests can be confirmed as paid.", 409);

    storageKey = await savePrivateDocument(bytes, extname(proof.name).toLowerCase());
    const outcome = await db.$transaction(async (tx) => {
      const current = await tx.paymentRequest.findUnique({
        where: { id },
        select: { id: true, transactionId: true, requestorId: true, status: true },
      });
      if (!current) return { response: jsonError("Payment request not found.", 404) };
      if (current.status !== PaymentStatus.APPROVED) return { response: jsonError("This request is not approved or has already been paid.", 409) };
      const currency = await tx.paymentCurrency.findFirst({ where: { code: currencyCode, isActive: true } });
      if (!currency) return { response: jsonError("The selected payment currency is not active.", 400) };
      const rate = currency.code === "USD"
        ? { usdPerUnit: new Prisma.Decimal(1), source: "USD base currency" }
        : await tx.currencyExchangeRate.findFirst({
            where: { currencyCode, effectiveAt: { lte: actualPaymentDate } },
            orderBy: { effectiveAt: "desc" },
          });
      if (!rate) return { response: jsonError("No exchange rate is configured for this currency on the payment date. Configure a rate before recording the confirmation.", 409) };
      const changed = await tx.paymentRequest.updateMany({
        where: { id, status: PaymentStatus.APPROVED },
        data: { status: PaymentStatus.PAID },
      });
      if (changed.count !== 1) return { response: jsonError("This request has already been paid or its status changed.", 409) };
      const document = await tx.paymentDocument.create({
        data: {
          requestId: id,
          ownerId: auth.user.id,
          kind: DocumentKind.PAYMENT_PROOF,
          filename: proof.name.slice(0, 180),
          storageKey: storageKey!,
          mimeType,
          sizeBytes: bytes.byteLength,
        },
        select: { id: true, filename: true, mimeType: true, sizeBytes: true },
      });
      const amountPaidUsd = new Prisma.Decimal(amountPaidValue).mul(rate.usdPerUnit);
      const confirmation = await tx.paymentConfirmation.create({
        data: {
          requestId: id,
          amountPaid: new Prisma.Decimal(amountPaidValue),
          currencyCode,
          amountPaidUsd,
          exchangeRate: rate.usdPerUnit,
          exchangeRateSource: rate.source,
          actualPaymentDate,
          paymentReference,
          paymentMethod,
          paymentAccount,
          remarks: remarks || null,
          proofDocumentId: document.id,
          processedById: auth.user.id,
        },
        select: { id: true, amountPaid: true, currencyCode: true, amountPaidUsd: true, actualPaymentDate: true, paymentReference: true },
      });
      await tx.paymentRequestHistory.create({
        data: {
          requestId: id,
          actorId: auth.user.id,
          action: "PAYMENT_CONFIRMED",
          fromStatus: PaymentStatus.APPROVED,
          toStatus: PaymentStatus.PAID,
          description: `Manual payment confirmed. Reference ${paymentReference}.`,
        },
      });
      const { ip, userAgent } = auditContext(request);
      await recordAudit(tx, {
        actorId: auth.user.id, actorName: auth.user.fullName, action: "PAYMENT_CONFIRMED",
        entityType: "PAYMENT_REQUEST", entityId: id, summary: `Paid ${amountPaidValue} ${currencyCode} (ref ${paymentReference}).`,
        previousValue: { status: PaymentStatus.APPROVED }, newValue: { status: PaymentStatus.PAID, amountPaidUsd: amountPaidUsd.toString() }, ip, userAgent,
      });
      const eventKey = notificationEventKey(id, "payment_paid", actualPaymentDate);
      await queueNotification(tx, {
        userId: current.requestorId,
        requestId: id,
        eventKey: `${eventKey}:requestor`,
        category: "payment",
        templateKey: "payment_confirmation",
        title: "Payment paid",
        message: `${current.transactionId} was marked paid by Accounts Payable.`,
        href: `/payment-requests/${id}`,
      });
      const apUsers = await tx.user.findMany({
        where: { isActive: true, roles: { some: { role: { key: "ACCOUNTS_PAYABLE" } } } },
        select: { id: true },
      });
      for (const recipient of apUsers) {
        await queueNotification(tx, {
          userId: recipient.id,
          requestId: id,
          eventKey: `${eventKey}:ap`,
          category: "ap_updates",
          templateKey: "ap_update",
          title: "Payment confirmation completed",
          message: `${current.transactionId} was marked paid by ${auth.user.fullName}.`,
          href: `/payment-requests/${id}`,
        });
      }
      return { confirmation, document };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if ("response" in outcome) {
      await removePrivateDocument(storageKey);
      storageKey = null;
      return outcome.response;
    }
    return NextResponse.json(outcome, { status: 201 });
  } catch (error) {
    if (storageKey) {
      try { await removePrivateDocument(storageKey); } catch (cleanupError) {
        console.error("Payment proof cleanup failed after confirmation error.", cleanupError);
      }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return jsonError("This payment reference or transaction already has a confirmation.", 409);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return jsonError("Payment status changed while recording confirmation. Refresh and retry.", 409);
    }
    console.error("Payment confirmation failed.", error);
    return jsonError("Payment could not be confirmed. Please review the request and retry.", 500);
  }
}
