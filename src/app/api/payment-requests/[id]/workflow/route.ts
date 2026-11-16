import { NextResponse } from "next/server";
import { z } from "zod";
import { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { jsonError, requireUser } from "@/lib/api";
import { approvalBandForValue, approvalBandProblem } from "@/lib/approval-workflow";
import { defaultReminderHours, validReminderHours } from "@/lib/notification-settings";
import { notificationEventKey, queueNotification } from "@/lib/notifications";
import { autoSchedulePayment } from "@/lib/payment-schedule-service";
import { auditContext, recordAudit } from "@/lib/audit";

const actionSchema = z.object({
  action: z.enum(["start_review", "send_approval", "clarification", "request_clarification", "return", "ap_reject", "reject", "approve"]),
  comment: z.string().trim().max(2000).optional(),
});
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return jsonError("Choose a valid workflow action and provide a comment no longer than 2,000 characters.", 400);
  const { action, comment } = parsed.data;
  const apAction = ["start_review", "send_approval", "clarification", "return", "ap_reject"].includes(action);
  if (apAction && !auth.user.permissions.includes("ap:access")) return jsonError("AP review permission is required.", 403);
  if (["approve", "reject", "request_clarification"].includes(action) && !auth.user.permissions.includes("approvals:access")) return jsonError("Approver permission is required.", 403);
  if (["clarification", "request_clarification", "return", "ap_reject", "reject"].includes(action) && !comment?.trim()) {
    return jsonError("A reason or comment is required for this action.", 400);
  }
  const { id } = await context.params;
  const { ip, userAgent } = auditContext(request);

  try {
    const result = await db.$transaction(async (tx) => {
      const item = await tx.paymentRequest.findUnique({
        where: { id },
        select: {
          id: true, requestorId: true, transactionId: true, status: true, finalValueUsd: true,
          vendorName: true, invoiceNumber: true,
          project: { select: { name: true } },
          requestor: { select: { fullName: true } },
        },
      });
      if (!item) return { response: jsonError("Payment request not found.", 404) };
      let assignment: { id: string; approverId: string } | null = null;
      let nextStatus: PaymentStatus;
      let actionName = action.toUpperCase();
      let expected: PaymentStatus;

      if (apAction) {
        if (action === "start_review") {
          expected = item.status === PaymentStatus.RETURNED ? PaymentStatus.RETURNED : PaymentStatus.PENDING_REVIEW;
          nextStatus = PaymentStatus.UNDER_REVIEW;
        } else if (action === "send_approval") {
          expected = PaymentStatus.UNDER_REVIEW;
          nextStatus = PaymentStatus.PENDING_APPROVAL;
          if (!item.finalValueUsd) return { response: jsonError("A final USD value is required before approval routing.", 409) };
          const bands = await tx.approvalThreshold.findMany({ where: { isActive: true }, orderBy: { minUsd: "asc" } });
          const bandInput = bands.map((band) => ({
            ...band,
            minUsd: band.minUsd.toString(),
            maxUsdExclusive: band.maxUsdExclusive?.toString() ?? null,
          }));
          const problem = approvalBandProblem(item.finalValueUsd.toString(), bandInput);
          if (problem) return { response: jsonError(problem, 409) };
          const band = approvalBandForValue(item.finalValueUsd.toString(), bandInput);
          if (!band?.assignedApproverId) return { response: jsonError("An approver is not configured for this threshold.", 409) };
          if (band.assignedApproverId === item.requestorId) return { response: jsonError("A requestor cannot approve their own payment request. Assign a different approver.", 409) };
          const activeApprover = await tx.user.findFirst({
            where: { id: band.assignedApproverId, isActive: true, roles: { some: { role: { key: "APPROVER" } } } },
            select: { id: true },
          });
          if (!activeApprover) return { response: jsonError("The configured approver is no longer active or no longer has the Approver role.", 409) };
          assignment = { id: band.id, approverId: activeApprover.id };
          actionName = "FORWARDED_FOR_APPROVAL";
        } else {
          expected = item.status;
          if (![PaymentStatus.PENDING_REVIEW, PaymentStatus.UNDER_REVIEW, PaymentStatus.PENDING_APPROVAL, PaymentStatus.RETURNED].some((status) => status === expected)) {
            return { response: jsonError("This request is not at a stage where AP can return it.", 409) };
          }
          nextStatus = action === "ap_reject" ? PaymentStatus.REJECTED
            : action === "return" ? PaymentStatus.RETURNED
            : PaymentStatus.NEEDS_INFORMATION;
          if (action === "ap_reject") actionName = "AP_REJECTED";
        }
      } else {
        expected = PaymentStatus.PENDING_APPROVAL;
        nextStatus = action === "approve" ? PaymentStatus.APPROVED
          : action === "reject" ? PaymentStatus.REJECTED
          : PaymentStatus.NEEDS_INFORMATION;
        assignment = await tx.approvalAssignment.findFirst({
          where: { requestId: id, approverId: auth.user.id, resolvedAt: null },
          select: { id: true, approverId: true },
        });
        if (!assignment || assignment.approverId === item.requestorId) return { response: jsonError("This approval is not assigned to you.", 403) };
      }

      const changed = await tx.paymentRequest.updateMany({ where: { id, status: expected }, data: { status: nextStatus } });
      if (changed.count !== 1) return { response: jsonError("This request has already changed. Refresh and review its current status.", 409) };
      if (assignment && action === "send_approval") {
        const approvalAssignment = await tx.approvalAssignment.create({
          data: { requestId: id, approverId: assignment.approverId, thresholdId: assignment.id },
          select: { id: true, assignedAt: true },
        });
        const settings = await tx.notificationSettings.findUnique({ where: { id: "default" }, select: { reminderHours: true } });
        const reminderHours = validReminderHours(settings?.reminderHours) ?? [...defaultReminderHours];
        await tx.reminderSchedule.create({
          data: {
            assignmentId: approvalAssignment.id,
            nextStage: 1,
            nextReminderAt: new Date(approvalAssignment.assignedAt.getTime() + reminderHours[0] * 60 * 60 * 1000),
          },
        });
      } else if (assignment && ["approve", "reject", "request_clarification"].includes(action)) {
        await tx.approvalAssignment.update({ where: { id: assignment.id }, data: { resolvedAt: new Date() } });
      } else if (["return", "ap_reject", "clarification"].includes(action)) {
        await tx.approvalAssignment.updateMany({ where: { requestId: id, resolvedAt: null }, data: { resolvedAt: new Date() } });
      }
      if (item.status === PaymentStatus.PENDING_APPROVAL || nextStatus !== PaymentStatus.PENDING_APPROVAL) {
        await tx.reminderSchedule.updateMany({
          where: { assignment: { requestId: id }, canceledAt: null },
          data: { canceledAt: new Date(), nextReminderAt: null },
        });
      }
      await tx.paymentRequestHistory.create({
        data: {
          requestId: id,
          actorId: auth.user.id,
          action: actionName,
          fromStatus: expected,
          toStatus: nextStatus,
          description: comment?.trim() || (action === "start_review" ? "AP review started." : null),
        },
      });
      if (comment?.trim()) {
        await tx.approvalComment.create({
          data: {
            requestId: id,
            actorId: auth.user.id,
            assignmentId: assignment && action !== "send_approval" ? assignment.id : null,
            action: actionName,
            content: comment.trim(),
          },
        });
      }
      if (nextStatus === PaymentStatus.NEEDS_INFORMATION) {
        await tx.clarificationRequest.create({
          data: { requestId: id, createdById: auth.user.id, reason: comment!.trim() },
        });
      }
      const notificationStatuses = new Set<PaymentStatus>([
        PaymentStatus.APPROVED,
        PaymentStatus.REJECTED,
        PaymentStatus.RETURNED,
        PaymentStatus.NEEDS_INFORMATION,
      ]);
      const apUsers = notificationStatuses.has(nextStatus)
        ? await tx.user.findMany({
            where: { isActive: true, roles: { some: { role: { key: "ACCOUNTS_PAYABLE" } } } },
            select: { id: true },
          })
        : [];
      const actionAt = new Date();
      const eventKey = notificationEventKey(id, actionName.toLowerCase(), actionAt);
      if (action === "send_approval" && assignment) {
        await queueNotification(tx, {
          userId: assignment.approverId,
          requestId: id,
          eventKey,
          category: "approval_request",
          templateKey: "approval_request",
          title: "New approval request",
          message: `${item.transactionId} from ${item.vendorName ?? "the vendor"} (${item.project?.name ?? "unassigned project"}) is awaiting your approval. Invoice value: $${item.finalValueUsd?.toString() ?? "0"} USD. Requestor: ${item.requestor.fullName}.`,
          href: `/payment-requests/${id}`,
        });
        await queueNotification(tx, {
          userId: item.requestorId,
          requestId: id,
          eventKey: `${eventKey}:requestor`,
          category: "approval_request",
          templateKey: "approval_request",
          title: "Sent for Approval",
          message: `${item.transactionId} was forwarded by Accounts Payable for approval.`,
          href: `/payment-requests/${id}`,
        });
      }
      if (notificationStatuses.has(nextStatus)) {
        const requestorNotification = nextStatus === PaymentStatus.NEEDS_INFORMATION
          ? { category: "clarification" as const, templateKey: "clarification" as const, title: "Clarification required", message: `${item.transactionId} needs an update before review can continue. ${comment?.trim() ?? ""}` }
          : nextStatus === PaymentStatus.RETURNED
            ? { category: "clarification" as const, templateKey: "clarification" as const, title: "Payment request returned", message: `${item.transactionId} was returned by Accounts Payable. ${comment?.trim() ?? ""}` }
            : nextStatus === PaymentStatus.REJECTED
              ? { category: "approval_decision" as const, templateKey: "rejection" as const, title: "Payment request rejected", message: `${item.transactionId} was rejected. ${comment?.trim() ?? ""}` }
              : { category: "approval_decision" as const, templateKey: "approval_confirmation" as const, title: "Payment request approved", message: `${item.transactionId} was approved and is awaiting AP payment processing.` };
        await queueNotification(tx, {
          userId: item.requestorId,
          requestId: id,
          eventKey: `${eventKey}:requestor`,
          ...requestorNotification,
          href: `/payment-requests/${id}`,
        });
        for (const recipient of apUsers) {
          await queueNotification(tx, {
            userId: recipient.id,
            requestId: id,
            eventKey: `${eventKey}:ap`,
            category: "ap_updates",
            templateKey: "ap_update",
            title: nextStatus === PaymentStatus.APPROVED ? "Invoice approved" :
              nextStatus === PaymentStatus.REJECTED ? "Invoice rejected" :
                nextStatus === PaymentStatus.RETURNED ? "Invoice returned" : "Clarification requested",
            message: `${item.transactionId} · ${item.vendorName ?? "Vendor"} · ${item.invoiceNumber ?? "No invoice number"} · ${nextStatus.replaceAll("_", " ")}.`,
            href: `/payment-requests/${id}`,
          });
        }
      }
      // On approval, compute the earliest eligible Wednesday payment schedule and risk.
      if (nextStatus === PaymentStatus.APPROVED) {
        await autoSchedulePayment(tx, id, auth.user.id);
      }
      await recordAudit(tx, {
        actorId: auth.user.id, actorName: auth.user.fullName, action: `WORKFLOW_${actionName}`,
        entityType: "PAYMENT_REQUEST", entityId: id, summary: comment?.trim() || null,
        previousValue: { status: expected }, newValue: { status: nextStatus }, ip, userAgent,
      });
      return { status: nextStatus };
    });
    if ("response" in result) return result.response;
    return NextResponse.json(result);
  } catch (error) {
    console.error("Payment approval workflow action failed.", error);
    return jsonError("The workflow action could not be completed. Refresh and try again.", 500);
  }
}
