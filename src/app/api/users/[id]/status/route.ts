import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/api";
import { auditContext, recordAuditSafe } from "@/lib/audit";
import { db } from "@/lib/db";
import { z } from "zod";

const statusSchema = z.object({ isActive: z.boolean() });

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requirePermission("users:activate");
  if ("response" in access) return access.response;
  const body: unknown = await request.json().catch(() => null);
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Select a valid account status." }, { status: 400 });

  const { id } = await context.params;
  if (id === access.user.id && !parsed.data.isActive) {
    return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
  }
  const target = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      activatedAt: true,
      permissions: { where: { permission: { key: "platform:admin" } }, select: { userId: true } },
    },
  });
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
  if (!target.activatedAt && parsed.data.isActive) {
    return NextResponse.json({ error: "An invited employee must activate their account before it can be enabled." }, { status: 400 });
  }
  if (target.permissions.length && !access.user.permissions.includes("platform:admin")) {
    return NextResponse.json({ error: "Only a platform administrator may change this account's status." }, { status: 403 });
  }
  const updated = await db.$transaction(async (transaction) => {
    const result = await transaction.user.updateMany({
      where: { id },
      data: { isActive: parsed.data.isActive },
    });
    if (result.count !== 1) return false;
    if (!parsed.data.isActive) {
      await transaction.authSession.deleteMany({ where: { userId: id } });
      await transaction.invitation.updateMany({
        where: { userId: id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await transaction.accountToken.updateMany({
        where: { userId: id, usedAt: null },
        data: { usedAt: new Date() },
      });
    }
    return true;
  });
  if (!updated) return NextResponse.json({ error: "User not found." }, { status: 404 });
  const { ip, userAgent } = auditContext(request);
  await recordAuditSafe({ actorId: access.user.id, actorName: access.user.fullName, action: parsed.data.isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED", entityType: "USER", entityId: id, newValue: { isActive: parsed.data.isActive }, ip, userAgent });
  return NextResponse.json({ success: true });
}
