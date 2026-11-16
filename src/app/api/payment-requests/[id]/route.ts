import { NextResponse } from "next/server";
import { DocumentKind, PaymentStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { jsonError, requireUser } from "@/lib/api";
import { canReadPayment, dateFromInput, errorResponse, paymentStatusLabel } from "@/lib/payment-requests";
import { calculatePaymentValues, duplicateInvoiceKey } from "@/lib/payment-calculations";
import { paymentDraftSchema, validateDraftFields, validateSubmission } from "@/lib/payment-validation";
import { activeMasterExists } from "@/lib/payment-requests";
import { redactPaymentAccount } from "@/lib/payment-corrections";
import { notificationEventKey, queueNotification } from "@/lib/notifications";
import { auditContext, recordAudit } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string }> };

function auditPaymentRequestValue(payment: {
  status: PaymentStatus;
  vendorName: string | null;
  invoiceNumber: string | null;
  currencyCode: string | null;
  invoiceAmount: Prisma.Decimal | null;
  dueDate: Date | null;
}) {
  return {
    status: payment.status,
    vendorName: payment.vendorName,
    invoiceNumber: payment.invoiceNumber,
    currencyCode: payment.currencyCode,
    invoiceAmount: payment.invoiceAmount?.toString() ?? null,
    dueDate: payment.dueDate?.toISOString().slice(0, 10) ?? null,
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const item = await db.paymentRequest.findUnique({
    where: { id },
    include: {
      currency: { select: { code: true, name: true, symbol: true, decimalPlaces: true } },
      billToEntity: { select: { id: true, name: true, code: true } },
      costCenter: { select: { id: true, name: true, code: true } },
      project: { select: { id: true, name: true, code: true } },
      requestor: { select: { id: true, fullName: true, email: true } },
      documents: { select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true } },
      history: {
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { fullName: true } } },
      },
      approvalAssignments: {
        orderBy: { assignedAt: "asc" },
        include: {
          approver: { select: { fullName: true } },
          threshold: { select: { label: true } },
          comments: { orderBy: { createdAt: "asc" }, include: { actor: { select: { fullName: true } } } },
        },
      },
      approvalComments: {
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { fullName: true } } },
      },
      clarificationRequests: {
        orderBy: { createdAt: "asc" },
        include: { createdBy: { select: { fullName: true } } },
      },
      paymentSchedule: { select: { plannedDate: true, earliestEligibleDate: true, riskStatus: true, autoScheduled: true, remarks: true, updatedAt: true } },
      scheduleHistory: {
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { fullName: true } } },
      },
      paymentConfirmation: {
        include: {
          currency: { select: { code: true, name: true, symbol: true } },
          processedBy: { select: { id: true, fullName: true } },
          proofDocument: { select: { id: true, filename: true, mimeType: true, sizeBytes: true } },
          corrections: {
            orderBy: { createdAt: "asc" },
            include: { actor: { select: { fullName: true } } },
          },
        },
      },
    },
  });
  if (!item) return jsonError("Payment request not found.", 404);
  const assignedApprover = auth.user.permissions.includes("approvals:access")
    ? item.approvalAssignments.some((assignment) => assignment.approverId === auth.user.id)
    : false;
  const canAdminRead = auth.user.permissions.includes("platform:admin") && item.status !== PaymentStatus.DRAFT;
  if (!canReadPayment(auth.user, item) && !assignedApprover && !canAdminRead) return jsonError("Payment request not found.", 404);
  const canReadPaymentAccount = auth.user.permissions.includes("payments:read_payment_account");
  return NextResponse.json({
    ...item,
    paymentSchedule: item.paymentSchedule ? {
      ...item.paymentSchedule,
      plannedDate: item.paymentSchedule.plannedDate?.toISOString().slice(0, 10) ?? null,
      earliestEligibleDate: item.paymentSchedule.earliestEligibleDate?.toISOString().slice(0, 10) ?? null,
    } : null,
    scheduleHistory: item.scheduleHistory.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actorName: entry.actor?.fullName ?? "System",
      scheduledDate: entry.scheduledDate?.toISOString().slice(0, 10) ?? null,
      earliestEligibleDate: entry.earliestEligibleDate?.toISOString().slice(0, 10) ?? null,
      dueDate: entry.dueDate?.toISOString().slice(0, 10) ?? null,
      riskStatus: entry.riskStatus,
      note: entry.note,
      createdAt: entry.createdAt.toISOString(),
    })),
    paymentConfirmation: item.paymentConfirmation ? {
      ...item.paymentConfirmation,
      amountPaid: item.paymentConfirmation.amountPaid.toString(),
      amountPaidUsd: item.paymentConfirmation.amountPaidUsd.toString(),
      exchangeRate: item.paymentConfirmation.exchangeRate.toString(),
      paymentAccount: canReadPaymentAccount ? item.paymentConfirmation.paymentAccount : "Restricted",
      actualPaymentDate: item.paymentConfirmation.actualPaymentDate.toISOString().slice(0, 10),
      proofDocument: auth.user.permissions.includes("ap:access") || auth.user.permissions.includes("payments:read_payment_proof")
        ? item.paymentConfirmation.proofDocument
        : null,
      corrections: item.paymentConfirmation.corrections.map((correction) => ({
        ...correction,
        previousValues: redactPaymentAccount(correction.previousValues, canReadPaymentAccount),
        correctedValues: redactPaymentAccount(correction.correctedValues, canReadPaymentAccount),
        actorName: correction.actor.fullName,
      })),
    } : null,
    statusLabel: paymentStatusLabel(item.status),
    invoiceDate: item.invoiceDate?.toISOString().slice(0, 10) ?? null,
    serviceStartDate: item.serviceStartDate?.toISOString().slice(0, 10) ?? null,
    serviceEndDate: item.serviceEndDate?.toISOString().slice(0, 10) ?? null,
    dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null,
    history: item.history.map((entry) => ({
      ...entry,
      actorName: entry.actor?.fullName ?? "System",
      statusLabel: entry.toStatus ? paymentStatusLabel(entry.toStatus) : null,
    })),
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (!auth.user.permissions.includes("payments:create")) return jsonError("You do not have permission to edit payment requests.", 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }
  const parsed = paymentDraftSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Please correct the highlighted fields.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const { id } = await context.params;
  const input = parsed.data;
  const { ip, userAgent } = auditContext(request);
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.paymentRequest.findUnique({ where: { id } });
      if (!current || current.requestorId !== auth.user.id) return jsonError("Payment request not found.", 404);
      if (current.status !== PaymentStatus.DRAFT && current.status !== PaymentStatus.NEEDS_INFORMATION) {
        return jsonError("Only drafts or requests awaiting clarification can be edited.", 409);
      }

      const [entityOk, centerOk, projectOk, currency] = await Promise.all([
        input.billToEntityId ? activeMasterExists("entity", input.billToEntityId) : true,
        input.costCenterId ? activeMasterExists("costCenter", input.costCenterId) : true,
        input.projectId ? activeMasterExists("project", input.projectId) : true,
        input.currencyCode
          ? tx.paymentCurrency.findFirst({ where: { code: input.currencyCode, isActive: true } })
          : Promise.resolve(null),
      ]);
      if (!entityOk || !centerOk || !projectOk || (input.currencyCode && !currency)) {
        return jsonError("A selected dropdown value is no longer active. Refresh the form and try again.", 400);
      }
      const draftErrors = validateDraftFields(input, currency?.decimalPlaces ?? 6);
      if (Object.keys(draftErrors).length) return NextResponse.json({ error: "Please correct the highlighted fields.", fields: draftErrors }, { status: 400 });

      const ids = [...new Set([input.invoiceDocumentId, ...input.attachmentIds].filter(Boolean) as string[])];
      const documents = ids.length
        ? await tx.paymentDocument.findMany({
            where: {
              id: { in: ids },
              ownerId: auth.user.id,
              OR: [{ requestId: null }, { requestId: id }],
            },
          })
        : [];
      const invoiceExists = documents.some((document) => document.id === input.invoiceDocumentId && document.kind === DocumentKind.INVOICE);
      let rate = null;
      if (currency && input.invoiceDate) {
        rate = currency.code === "USD"
          ? { usdPerUnit: new Prisma.Decimal(1), source: "USD base currency", effectiveAt: dateFromInput(input.invoiceDate)! }
          : await tx.currencyExchangeRate.findFirst({
              where: { currencyCode: currency.code, effectiveAt: { lte: dateFromInput(input.invoiceDate)! } },
              orderBy: { effectiveAt: "desc" },
            });
      }
      const errors = input.action === "submit"
        ? validateSubmission(input, {
            currencyDecimals: currency?.decimalPlaces ?? 2,
            now: new Date(),
            hasInvoiceDocument: invoiceExists,
            hasExchangeRate: Boolean(rate),
          })
        : {};
      if (Object.keys(errors).length) return NextResponse.json({ error: "Please correct the highlighted fields.", fields: errors }, { status: 400 });
      if (documents.length !== ids.length) return jsonError("One or more documents are unavailable.", 400);
      if (input.invoiceDocumentId && !invoiceExists) return jsonError("The invoice file is missing or is not marked as an invoice.", 400);
      if (input.action === "submit" && input.attachmentIds.some((docId) => !documents.some((doc) => doc.id === docId && doc.kind === DocumentKind.ATTACHMENT))) {
        return jsonError("One or more attachments are unavailable.", 400);
      }

      const key = input.action === "submit"
        ? duplicateInvoiceKey(input.vendorName!, input.invoiceNumber!, input.invoiceAmount!)
        : null;
      if (key) {
        const duplicate = await tx.paymentRequest.findUnique({ where: { duplicateKey: key } });
        if (duplicate && duplicate.id !== id) {
          const canReference = duplicate.requestorId === auth.user.id || auth.user.permissions.includes("payments:read_all");
          return NextResponse.json({
            error: "This vendor, invoice number, and invoice amount match an existing payment request.",
            duplicate: canReference ? { transactionId: duplicate.transactionId, href: `/payment-requests/${duplicate.id}` } : undefined,
          }, { status: 409 });
        }
      }
      const values = input.invoiceAmount && rate
        ? calculatePaymentValues(input.invoiceAmount, input.taxAmount, rate.usdPerUnit.toString())
        : null;
      const status = input.action === "submit"
        ? PaymentStatus.PENDING_REVIEW
        : current.status === PaymentStatus.NEEDS_INFORMATION ? PaymentStatus.NEEDS_INFORMATION : PaymentStatus.DRAFT;
      const claimed = await tx.paymentRequest.updateMany({
        where: { id, requestorId: auth.user.id, status: current.status },
        data: { status },
      });
      if (claimed.count !== 1) return jsonError("This request has changed. Refresh and retry.", 409);
      await tx.paymentDocument.updateMany({
        where: { id: { in: ids }, requestId: null, ownerId: auth.user.id },
        data: { requestId: id },
      });
      const saved = await tx.paymentRequest.update({
        where: { id },
        data: {
          status,
          vendorName: input.vendorName ?? null,
          description: input.description ?? null,
          billToEntityId: input.billToEntityId || null,
          billFrom: input.billFrom ?? null,
          invoiceNumber: input.invoiceNumber ?? null,
          invoiceDate: dateFromInput(input.invoiceDate),
          serviceStartDate: dateFromInput(input.serviceStartDate),
          serviceEndDate: dateFromInput(input.serviceEndDate),
          currencyCode: currency?.code ?? null,
          invoiceAmount: values?.invoiceAmount ?? (input.invoiceAmount ? new Prisma.Decimal(input.invoiceAmount) : null),
          invoiceAmountUsd: values?.invoiceAmountUsd ?? null,
          taxAmount: values?.taxAmount ?? (input.taxAmount ? new Prisma.Decimal(input.taxAmount) : null),
          totalPayable: values?.totalPayable ?? null,
          finalValueUsd: values?.finalValueUsd ?? null,
          exchangeRate: values?.exchangeRate ?? null,
          exchangeRateSource: rate?.source ?? null,
          conversionDate: rate?.effectiveAt ?? null,
          dueDate: dateFromInput(input.dueDate),
          costCenterId: input.costCenterId || null,
          projectId: input.projectId || null,
          duplicateKey: key,
          submittedAt: input.action === "submit" ? new Date() : current.status === PaymentStatus.DRAFT ? null : current.submittedAt,
          history: {
            create: {
              actorId: auth.user.id,
              action: input.action === "submit"
                ? current.status === PaymentStatus.NEEDS_INFORMATION ? "RESUBMITTED" : "SUBMITTED"
                : "DRAFT_UPDATED",
              fromStatus: current.status,
              toStatus: status,
              description: input.action === "submit"
                ? current.status === PaymentStatus.NEEDS_INFORMATION ? "Updated payment request resubmitted to AP for review." : "Payment request submitted to AP for review."
                : "Draft payment request updated.",
            },
          },
        },
        select: { id: true, transactionId: true, status: true },
      });
      await recordAudit(tx, {
        actorId: auth.user.id,
        actorName: auth.user.fullName,
        action: input.action === "submit"
          ? current.status === PaymentStatus.NEEDS_INFORMATION ? "PAYMENT_REQUEST_RESUBMITTED" : "PAYMENT_REQUEST_SUBMITTED"
          : "PAYMENT_REQUEST_UPDATED",
        entityType: "PAYMENT_REQUEST",
        entityId: id,
        previousValue: auditPaymentRequestValue(current),
        newValue: {
          status: saved.status,
          vendorName: input.vendorName ?? null,
          invoiceNumber: input.invoiceNumber ?? null,
          currencyCode: currency?.code ?? null,
          invoiceAmount: values?.invoiceAmount?.toString() ?? input.invoiceAmount ?? null,
          dueDate: input.dueDate ?? null,
        },
        ip,
        userAgent,
      });
      if (input.action === "submit" && current.status === PaymentStatus.NEEDS_INFORMATION) {
        await tx.clarificationRequest.updateMany({
          where: { requestId: id, resolvedAt: null },
          data: { resolvedAt: new Date(), resolvedById: auth.user.id },
        });
      }
      if (input.action === "submit") {
        const submittedAt = new Date();
        const eventName = current.status === PaymentStatus.NEEDS_INFORMATION ? "resubmitted" : "submitted";
        const eventKey = notificationEventKey(id, eventName, submittedAt);
        await queueNotification(tx, {
          userId: auth.user.id,
          requestId: id,
          eventKey: `${eventKey}:requestor`,
          category: "request_submitted",
          templateKey: "request_submitted",
          title: current.status === PaymentStatus.NEEDS_INFORMATION ? "Corrected request resubmitted" : "Payment request submitted",
          message: `${saved.transactionId} was submitted for AP review.`,
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
            title: current.status === PaymentStatus.NEEDS_INFORMATION ? "Corrected invoice resubmitted" : "New payment request submitted",
            message: `${saved.transactionId} from ${input.vendorName} is ready for AP review.`,
            href: `/payment-requests/${id}`,
          });
        }
      }
      return NextResponse.json(saved);
    });
  } catch (error) {
    return errorResponse(error);
  }
}
