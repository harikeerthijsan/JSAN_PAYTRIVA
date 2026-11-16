import { NextResponse } from "next/server";
import { Prisma, PaymentStatus, DocumentKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { jsonError, requirePermission, requireUser } from "@/lib/api";
import {
  activeMasterExists,
  dateFromInput,
  errorResponse,
  newTransactionId,
  paymentStatusLabel,
} from "@/lib/payment-requests";
import { duplicateInvoiceKey, calculatePaymentValues } from "@/lib/payment-calculations";
import { paymentDraftSchema, validateDraftFields, validateSubmission } from "@/lib/payment-validation";
import { auditContext, recordAudit } from "@/lib/audit";

const pageSizeLimit = 50;

export async function GET(request: Request) {
  const authenticated = await requireUser();
  if ("response" in authenticated) return authenticated.response;
  const readAll = authenticated.user.permissions.includes("payments:read_all");
  if (!readAll && !authenticated.user.permissions.includes("payments:read_own")) {
    return jsonError("You do not have permission to view payment requests.", 403);
  }
  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(pageSizeLimit, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));
  const sortMap = {
    createdAt: "createdAt",
    submittedAt: "submittedAt",
    dueDate: "dueDate",
    vendorName: "vendorName",
    transactionId: "transactionId",
    status: "status",
  } as const;
  const requestedSort = url.searchParams.get("sort") as keyof typeof sortMap | null;
  const sort = sortMap[requestedSort ?? "createdAt"] ?? "createdAt";
  const direction = url.searchParams.get("direction") === "asc" ? "asc" : "desc";
  const search = url.searchParams.get("search")?.trim().slice(0, 100);
  const statusValue = url.searchParams.get("status");
  const statuses = Object.values(PaymentStatus);
  const status = statuses.includes(statusValue as PaymentStatus) ? (statusValue as PaymentStatus) : undefined;
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const validDate = (value: string | null) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime()) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  if (!validDate(dateFrom) || !validDate(dateTo)) return jsonError("Date filters must be valid calendar dates.", 400);
  const where: Prisma.PaymentRequestWhereInput = {
    ...(readAll
      ? { AND: [{ status: { not: PaymentStatus.DRAFT } }, ...(status ? [{ status }] : [])] }
      : { requestorId: authenticated.user.id, ...(status ? { status } : {}) }),
    ...(url.searchParams.get("projectId") ? { projectId: url.searchParams.get("projectId")! } : {}),
    ...(url.searchParams.get("vendor") ? { vendorName: { contains: url.searchParams.get("vendor")!.slice(0, 100), mode: "insensitive" } } : {}),
    ...(dateFrom || dateTo ? {
      createdAt: {
        ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
      },
    } : {}),
    ...(search ? {
      OR: [
        { transactionId: { contains: search, mode: "insensitive" } },
        { vendorName: { contains: search, mode: "insensitive" } },
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { project: { name: { contains: search, mode: "insensitive" } } },
        { requestor: { fullName: { contains: search, mode: "insensitive" } } },
      ],
    } : {}),
  };
  const [total, requests, groupedStatuses] = await Promise.all([
    db.paymentRequest.count({ where }),
    db.paymentRequest.findMany({
      where,
      orderBy: { [sort]: direction },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        currency: { select: { code: true, symbol: true, decimalPlaces: true } },
        project: { select: { id: true, name: true } },
        costCenter: { select: { name: true, code: true } },
        requestor: { select: { id: true, fullName: true, email: true } },
      },
    }),
    db.paymentRequest.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
  ]);
  return NextResponse.json({
    items: requests.map((item) => ({
      ...item,
      statusLabel: paymentStatusLabel(item.status),
      invoiceDate: item.invoiceDate?.toISOString().slice(0, 10) ?? null,
      dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null,
    })),
    total,
    statusCounts: Object.fromEntries(groupedStatuses.map((item) => [item.status, item._count._all])),
    page,
    pageSize,
    pages: Math.ceil(total / pageSize),
  });
}

export async function POST(request: Request) {
  const access = await requirePermission("payments:create");
  if ("response" in access) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }
  const parsed = paymentDraftSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Please correct the highlighted fields.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  try {
    const [entityOk, centerOk, projectOk, currency] = await Promise.all([
      input.billToEntityId ? activeMasterExists("entity", input.billToEntityId) : true,
      input.costCenterId ? activeMasterExists("costCenter", input.costCenterId) : true,
      input.projectId ? activeMasterExists("project", input.projectId) : true,
      input.currencyCode
        ? db.paymentCurrency.findFirst({ where: { code: input.currencyCode, isActive: true } })
        : Promise.resolve(null),
    ]);
    if (!entityOk || !centerOk || !projectOk || (input.currencyCode && !currency)) {
      return jsonError("A selected dropdown value is no longer active. Refresh the form and try again.", 400);
    }
    const draftErrors = validateDraftFields(input, currency?.decimalPlaces ?? 6);
    if (Object.keys(draftErrors).length) return NextResponse.json({ error: "Please correct the highlighted fields.", fields: draftErrors }, { status: 400 });

    const { ip, userAgent } = auditContext(request);
    return await db.$transaction(async (tx) => {
      const allDocumentIds = [...new Set([input.invoiceDocumentId, ...input.attachmentIds].filter(Boolean) as string[])];
      const documents = allDocumentIds.length
        ? await tx.paymentDocument.findMany({
            where: { id: { in: allDocumentIds }, ownerId: access.user.id, requestId: null },
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
      if (Object.keys(errors).length) {
        return NextResponse.json({ error: "Please correct the highlighted fields.", fields: errors }, { status: 400 });
      }
      if (allDocumentIds.length !== documents.length) return jsonError("One or more documents are unavailable.", 400);
      if (input.invoiceDocumentId && !invoiceExists) return jsonError("The invoice file is missing or is not marked as an invoice.", 400);
      if (input.action === "submit" && input.attachmentIds.some((id) => !documents.some((doc) => doc.id === id && doc.kind === DocumentKind.ATTACHMENT))) {
        return jsonError("One or more attachments are unavailable.", 400);
      }

      const duplicateKey = input.action === "submit"
        ? duplicateInvoiceKey(input.vendorName!, input.invoiceNumber!, input.invoiceAmount!)
        : null;
      if (duplicateKey) {
        const duplicate = await tx.paymentRequest.findUnique({
          where: { duplicateKey },
          select: { id: true, transactionId: true, requestorId: true, status: true },
        });
        if (duplicate) {
          const canReference = duplicate.requestorId === access.user.id || access.user.permissions.includes("payments:read_all");
          return NextResponse.json({
            error: "This vendor, invoice number, and invoice amount match an existing payment request.",
            duplicate: canReference ? { transactionId: duplicate.transactionId, href: `/payment-requests/${duplicate.id}` } : undefined,
          }, { status: 409 });
        }
      }

      const values = input.invoiceAmount && rate
        ? calculatePaymentValues(input.invoiceAmount, input.taxAmount, rate.usdPerUnit.toString())
        : null;
      const status = input.action === "submit" ? PaymentStatus.PENDING_REVIEW : PaymentStatus.DRAFT;
      const saved = await tx.paymentRequest.create({
        data: {
          transactionId: newTransactionId(),
          requestorId: access.user.id,
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
          duplicateKey,
          submittedAt: input.action === "submit" ? new Date() : null,
          documents: allDocumentIds.length ? { connect: allDocumentIds.map((id) => ({ id })) } : undefined,
          history: {
            create: {
              actorId: access.user.id,
              action: input.action === "submit" ? "SUBMITTED" : "DRAFT_CREATED",
              toStatus: status,
              description: input.action === "submit" ? "Payment request submitted for review." : "Draft payment request created.",
            },
          },
        },
        select: { id: true, transactionId: true, status: true },
      });
      await recordAudit(tx, {
        actorId: access.user.id,
        actorName: access.user.fullName,
        action: input.action === "submit" ? "PAYMENT_REQUEST_SUBMITTED" : "PAYMENT_REQUEST_CREATED",
        entityType: "PAYMENT_REQUEST",
        entityId: saved.id,
        newValue: {
          transactionId: saved.transactionId,
          status: saved.status,
          vendorName: input.vendorName ?? null,
          invoiceNumber: input.invoiceNumber ?? null,
          currencyCode: currency?.code ?? null,
          invoiceAmount: input.invoiceAmount ?? null,
          dueDate: input.dueDate ?? null,
        },
        ip,
        userAgent,
      });
      return NextResponse.json(saved, { status: 201 });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
