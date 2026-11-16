import "server-only";
import { randomBytes } from "node:crypto";
import { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";

export function newTransactionId(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `PTR-${date}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

export function canReadPayment(user: { id: string; permissions: string[] }, request: { requestorId: string; status: PaymentStatus }) {
  if (request.requestorId === user.id && user.permissions.includes("payments:read_own")) return true;
  return request.status !== "DRAFT" && user.permissions.includes("payments:read_all");
}

export function errorResponse(error: unknown) {
  const candidate = error as { code?: string };
  if (candidate?.code === "P2002") return jsonError("A matching invoice already exists. Review the existing request before submitting.", 409);
  if (candidate?.code === "P2003") return jsonError("One of the selected master records is no longer available.", 400);
  console.error("Payment request operation failed.", error);
  return jsonError("The payment request could not be saved. Please try again.", 500);
}

export function dateFromInput(value?: string): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

export function toDateInput(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export const terminalSubmissionStatuses = [
  PaymentStatus.PENDING_REVIEW,
  PaymentStatus.UNDER_REVIEW,
  PaymentStatus.PENDING_APPROVAL,
  PaymentStatus.RETURNED,
  PaymentStatus.NEEDS_INFORMATION,
  PaymentStatus.APPROVED,
  PaymentStatus.REJECTED,
  PaymentStatus.PAID,
  PaymentStatus.CANCELLED,
];

export function paymentStatusLabel(status: PaymentStatus): string {
  const labels: Partial<Record<PaymentStatus, string>> = {
    [PaymentStatus.PENDING_REVIEW]: "Pending Review",
    [PaymentStatus.RETURNED]: "Returned",
    [PaymentStatus.APPROVED]: "Approved and Waiting for Payment",
    [PaymentStatus.REJECTED]: "Rejected",
    [PaymentStatus.PAID]: "Paid",
    [PaymentStatus.NEEDS_INFORMATION]: "Sent Back for Clarifications",
  };
  if (labels[status]) return labels[status] ?? status;
  return status.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export async function activeMasterExists(
  type: "entity" | "costCenter" | "project" | "currency",
  idOrCode: string,
) {
  if (type === "entity") return Boolean(await db.paymentEntity.findFirst({ where: { id: idOrCode, isActive: true }, select: { id: true } }));
  if (type === "costCenter") return Boolean(await db.costCenter.findFirst({ where: { id: idOrCode, isActive: true }, select: { id: true } }));
  if (type === "project") return Boolean(await db.paymentProject.findFirst({ where: { id: idOrCode, isActive: true }, select: { id: true } }));
  return Boolean(await db.paymentCurrency.findFirst({ where: { code: idOrCode, isActive: true }, select: { code: true } }));
}
