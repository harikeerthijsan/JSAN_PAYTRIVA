import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, requirePermission } from "@/lib/api";
import { auditContext, recordAudit } from "@/lib/audit";

class MatrixValidationError extends Error {}

export async function GET() {
  const auth = await requirePermission("payments:manage_masters");
  if ("response" in auth) return auth.response;
  const thresholds = await db.approvalThreshold.findMany({
    orderBy: { minUsd: "asc" },
    include: { assignedApprover: { select: { id: true, fullName: true, email: true, isActive: true } } },
  });
  const assignedIds = thresholds.flatMap(({ assignedApproverId }) => assignedApproverId ? [assignedApproverId] : []);
  const approvers = await db.user.findMany({
    where: {
      OR: [
        { isActive: true, roles: { some: { role: { key: "APPROVER" } } } },
        ...(assignedIds.length ? [{ id: { in: assignedIds } }] : []),
      ],
    },
    select: { id: true, fullName: true, email: true, isActive: true },
    orderBy: { fullName: "asc" },
  });
  return NextResponse.json({ thresholds, approvers });
}

export async function PATCH(request: Request) {
  const auth = await requirePermission("payments:manage_masters");
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }
  if (!body || typeof body !== "object" || !("assignments" in body) || !Array.isArray(body.assignments)) {
    return jsonError("Approval threshold assignments are required.", 400);
  }
  const assignments = body.assignments as unknown[];
  if (assignments.length > 20 || assignments.some((entry) =>
    !entry || typeof entry !== "object" || !("thresholdId" in entry) || typeof entry.thresholdId !== "string" ||
    !("approverId" in entry) || !(typeof entry.approverId === "string" || entry.approverId === null)
  )) return jsonError("Approval threshold assignments are invalid.", 400);
  const values = assignments as { thresholdId: string; approverId: string | null }[];
  if (new Set(values.map((entry) => entry.thresholdId)).size !== values.length) return jsonError("Each threshold may only appear once.", 400);
  const { ip, userAgent } = auditContext(request);
  try {
    await db.$transaction(async (tx) => {
      const thresholds = await tx.approvalThreshold.findMany({ select: { id: true, assignedApproverId: true } });
      if (thresholds.length !== values.length || thresholds.some((threshold) => !values.some((entry) => entry.thresholdId === threshold.id))) {
        throw new MatrixValidationError("The approval matrix changed. Refresh and retry.");
      }
      const approverIds = [...new Set(values.flatMap((entry) => entry.approverId ? [entry.approverId] : []))];
      const approvers = approverIds.length ? await tx.user.findMany({
        where: { id: { in: approverIds }, isActive: true, roles: { some: { role: { key: "APPROVER" } } } },
        select: { id: true },
      }) : [];
      if (approvers.length !== approverIds.length) throw new MatrixValidationError("Every assigned user must be an active account with the Approver role.");
      for (const entry of values) {
        const previous = thresholds.find((threshold) => threshold.id === entry.thresholdId)?.assignedApproverId ?? null;
        await tx.approvalThreshold.update({
          where: { id: entry.thresholdId },
          data: { assignedApproverId: entry.approverId },
        });
        if (previous !== entry.approverId) {
          await recordAudit(tx, {
            actorId: auth.user.id,
            actorName: auth.user.fullName,
            action: "APPROVAL_THRESHOLD_ASSIGNMENT_CHANGED",
            entityType: "APPROVAL_THRESHOLD",
            entityId: entry.thresholdId,
            previousValue: { approverId: previous },
            newValue: { approverId: entry.approverId },
            ip,
            userAgent,
          });
        }
      }
    });
  } catch (error) {
    if (error instanceof MatrixValidationError) return jsonError(error.message, 400);
    console.error("Approval matrix update failed.", error);
    return jsonError("Approval matrix could not be saved. Please try again.", 500);
  }
  return NextResponse.json({ ok: true });
}
