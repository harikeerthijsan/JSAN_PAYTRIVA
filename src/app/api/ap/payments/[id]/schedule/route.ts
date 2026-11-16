import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { jsonError, requirePermission } from "@/lib/api";
import { reschedulePayment, ScheduleError } from "@/lib/payment-schedule-service";
import { auditContext, recordAudit } from "@/lib/audit";

const schema = z.object({
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  remarks: z.string().trim().max(1000).optional(),
});
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requirePermission("ap:access");
  if ("response" in auth) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Request body must be valid JSON.", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("Provide a valid planned payment date or clear the schedule.", 400);
  const { id } = await context.params;
  const plannedDate = parsed.data.plannedDate ? new Date(`${parsed.data.plannedDate}T00:00:00.000Z`) : null;
  if (plannedDate && (!Number.isFinite(plannedDate.getTime()) || plannedDate.toISOString().slice(0, 10) !== parsed.data.plannedDate)) {
    return jsonError("Planned payment date must be a valid calendar date.", 400);
  }
  const { ip, userAgent } = auditContext(request);
  try {
    const saved = await db.$transaction(
      async (tx) => {
        const previous = await tx.paymentSchedule.findUnique({
          where: { requestId: id },
          select: { plannedDate: true, earliestEligibleDate: true, riskStatus: true, autoScheduled: true },
        });
        const result = await reschedulePayment(tx, {
          requestId: id,
          actorId: auth.user.id,
          plannedDate,
          remarks: parsed.data.remarks,
        });
        await recordAudit(tx, {
          actorId: auth.user.id,
          actorName: auth.user.fullName,
          action: plannedDate ? "PAYMENT_SCHEDULE_CHANGED" : "PAYMENT_SCHEDULE_CLEARED",
          entityType: "PAYMENT_REQUEST",
          entityId: id,
          previousValue: {
            plannedDate: previous?.plannedDate?.toISOString().slice(0, 10) ?? null,
            earliestEligibleDate: previous?.earliestEligibleDate?.toISOString().slice(0, 10) ?? null,
            riskStatus: previous?.riskStatus ?? null,
            autoScheduled: previous?.autoScheduled ?? null,
          },
          newValue: {
            plannedDate: result.plannedDate,
            earliestEligibleDate: result.earliestEligibleDate,
            riskStatus: result.riskStatus,
            autoScheduled: false,
          },
          ip,
          userAgent,
        });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof ScheduleError) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "NOT_APPROVED" ? 409 : 400;
      return jsonError(error.message, status);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return jsonError("Payment status changed while scheduling. Refresh and retry.", 409);
    }
    console.error("Unable to save the planned payment date.", error);
    return jsonError("The payment schedule could not be saved.", 500);
  }
}
