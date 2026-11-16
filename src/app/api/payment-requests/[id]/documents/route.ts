import { extname } from "node:path";
import { NextResponse } from "next/server";
import { DocumentKind, PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { jsonError, requirePermission } from "@/lib/api";
import { validateFileType } from "@/lib/payment-file-validation";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENT_COUNT, MAX_TOTAL_UPLOAD_BYTES, removePrivateDocument, savePrivateDocument } from "@/lib/payment-storage";
import { auditContext, recordAudit } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requirePermission("payments:create");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const payment = await db.paymentRequest.findFirst({
    where: { id, requestorId: auth.user.id, status: { in: [PaymentStatus.DRAFT, PaymentStatus.NEEDS_INFORMATION] } },
  });
  if (!payment) return jsonError("Draft or clarification-requested payment request not found.", 404);
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("The uploaded form data could not be read.", 400);
  }
  const file = formData.get("file");
  const rawKind = formData.get("kind");
  if (rawKind !== "INVOICE" && rawKind !== "ATTACHMENT") return jsonError("Document kind must be INVOICE or ATTACHMENT.", 400);
  const kind = rawKind === "ATTACHMENT" ? DocumentKind.ATTACHMENT : DocumentKind.INVOICE;
  if (!(file instanceof File)) return jsonError("Choose a file to upload.", 400);
  if (file.size < 1 || file.size > MAX_DOCUMENT_BYTES) return jsonError(`Files must be no larger than ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.`, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = validateFileType(file.name, file.type || "application/octet-stream", bytes);
  if (!mimeType) return jsonError("Unsupported file. Upload a PDF, XLS, XLSX, or JPG/JPEG with a matching file type.", 400);
  const existing = await db.paymentDocument.findMany({
    where: { requestId: id },
    select: { id: true, sizeBytes: true, kind: true, mimeType: true },
  });
  if (existing.length >= MAX_DOCUMENT_COUNT || existing.reduce((sum, doc) => sum + doc.sizeBytes, 0) + bytes.byteLength > MAX_TOTAL_UPLOAD_BYTES) {
    return jsonError("This request has reached its document count or total upload size limit.", 400);
  }
  const replaceExisting = new URL(request.url).searchParams.get("replace") === "1";
  const existingInvoice = existing.find((doc) => doc.kind === DocumentKind.INVOICE);
  if (kind === DocumentKind.INVOICE && existingInvoice && !replaceExisting) {
    return jsonError("Remove the existing invoice before uploading a replacement.", 409);
  }
  const extension = extname(file.name).toLowerCase();
  let storageKey: string | null = null;
  try {
    storageKey = await savePrivateDocument(bytes, extension);
    const { ip, userAgent } = auditContext(request);
    const saved = await db.$transaction(async (tx) => {
      const document = await tx.paymentDocument.create({
        data: {
          requestId: id,
          ownerId: auth.user.id,
          kind,
          filename: file.name.slice(0, 180),
          storageKey: storageKey!,
          mimeType,
          sizeBytes: bytes.byteLength,
        },
        select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true },
      });
      await recordAudit(tx, {
        actorId: auth.user.id,
        actorName: auth.user.fullName,
        action: kind === DocumentKind.INVOICE && replaceExisting && existingInvoice
          ? "PAYMENT_INVOICE_REPLACED"
          : "PAYMENT_DOCUMENT_UPLOADED",
        entityType: "PAYMENT_DOCUMENT",
        entityId: document.id,
        previousValue: kind === DocumentKind.INVOICE && replaceExisting && existingInvoice
          ? { kind: DocumentKind.INVOICE, documentId: existingInvoice.id, mimeType: existingInvoice.mimeType }
          : undefined,
        newValue: { kind: document.kind, mimeType: document.mimeType, sizeBytes: document.sizeBytes },
        ip,
        userAgent,
      });
      return document;
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    if (storageKey) {
      try {
        await removePrivateDocument(storageKey);
      } catch (cleanupError) {
        console.error("Unable to clean up an unreferenced payment upload.", cleanupError);
      }
    }
    console.error("Unable to store a payment document.", error);
    return jsonError("The document could not be stored. Please try again.", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requirePermission("payments:create");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  let documentId: string | null = null;
  try {
    documentId = new URL(request.url).searchParams.get("documentId");
  } catch {
    return jsonError("Invalid request.", 400);
  }
  if (!documentId) return jsonError("Document ID is required.", 400);
  const document = await db.paymentDocument.findFirst({
    where: {
      id: documentId,
      requestId: id,
      ownerId: auth.user.id,
      request: { status: { in: [PaymentStatus.DRAFT, PaymentStatus.NEEDS_INFORMATION] } },
    },
  });
  if (!document) return jsonError("Document not found.", 404);
  const { ip, userAgent } = auditContext(request);
  await db.$transaction(async (tx) => {
    await tx.paymentDocument.delete({ where: { id: document.id } });
    await recordAudit(tx, {
      actorId: auth.user.id,
      actorName: auth.user.fullName,
      action: "PAYMENT_DOCUMENT_REMOVED",
      entityType: "PAYMENT_DOCUMENT",
      entityId: document.id,
      previousValue: { kind: document.kind, mimeType: document.mimeType, sizeBytes: document.sizeBytes },
      newValue: { removed: true },
      ip,
      userAgent,
    });
  });
  try {
    await removePrivateDocument(document.storageKey);
  } catch (error) {
    console.error("Payment document metadata was removed but private file cleanup failed.", error);
    return jsonError("The document record was removed, but its stored file needs administrator cleanup.", 500);
  }
  return NextResponse.json({ ok: true });
}
