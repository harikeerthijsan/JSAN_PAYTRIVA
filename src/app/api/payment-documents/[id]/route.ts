import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, requireUser } from "@/lib/api";
import { canReadPayment } from "@/lib/payment-requests";
import { readPrivateDocument, safeDownloadName } from "@/lib/payment-storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const document = await db.paymentDocument.findUnique({
    where: { id },
    include: {
      request: {
        select: {
          id: true,
          requestorId: true,
          status: true,
          approvalAssignments: { where: { approverId: auth.user.id }, select: { id: true } },
        },
      },
    },
  });
  if (document?.kind === "PAYMENT_PROOF" &&
      !auth.user.permissions.includes("ap:access") &&
      !auth.user.permissions.includes("payments:read_payment_proof")) {
    return jsonError("Document not found.", 404);
  }
  const isAssignedApprover = Boolean(document?.request?.approvalAssignments.length && auth.user.permissions.includes("approvals:access"));
  const isPlatformAdmin = auth.user.permissions.includes("platform:admin") && document?.request?.status !== "DRAFT";
  if (!document || !document.request || (!canReadPayment(auth.user, document.request) && !isAssignedApprover && !isPlatformAdmin)) {
    return jsonError("Document not found.", 404);
  }
  try {
    const bytes = await readPrivateDocument(document.storageKey);
    const preview = new URL(_request.url).searchParams.get("preview") === "1" &&
      (document.mimeType === "application/pdf" || document.mimeType === "image/jpeg");
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new NextResponse(body, {
      headers: {
        "Content-Type": document.mimeType,
        "Content-Length": String(document.sizeBytes),
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${safeDownloadName(document.filename)}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Unable to read a payment document from private storage.", error);
    return jsonError("The requested document is unavailable.", 500);
  }
}
