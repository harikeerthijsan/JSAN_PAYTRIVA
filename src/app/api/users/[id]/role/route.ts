import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/api";
import { auditContext, recordAuditSafe } from "@/lib/audit";
import { db } from "@/lib/db";
import { z } from "zod";

const roleSchema = z.object({
  roleKey: z.enum(["REQUESTOR", "ACCOUNTS_PAYABLE", "APPROVER"]),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requirePermission("users:assign_role");
  if ("response" in access) return access.response;
  const body: unknown = await request.json().catch(() => null);
  const parsed = roleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Select a valid role." }, { status: 400 });

  const { id } = await context.params;
  if (id === access.user.id) {
    return NextResponse.json({ error: "You cannot change your own role." }, { status: 400 });
  }
  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, permissions: { where: { permission: { key: "platform:admin" } }, select: { userId: true } } },
  });
  const role = await db.role.findUnique({ where: { key: parsed.data.roleKey } });
  if (!target || !role) return NextResponse.json({ error: "User or role not found." }, { status: 404 });
  if (target.permissions.length && !access.user.permissions.includes("platform:admin")) {
    return NextResponse.json({ error: "Only a platform administrator may change this account's role." }, { status: 403 });
  }

  await db.$transaction([
    db.userRole.deleteMany({ where: { userId: id } }),
    db.userRole.create({
      data: { userId: id, roleId: role.id, assignedById: access.user.id },
    }),
  ]);
  const { ip, userAgent } = auditContext(request);
  await recordAuditSafe({ actorId: access.user.id, actorName: access.user.fullName, action: "USER_ROLE_CHANGED", entityType: "USER", entityId: id, newValue: { roleKey: parsed.data.roleKey }, ip, userAgent });
  return NextResponse.json({ success: true });
}
