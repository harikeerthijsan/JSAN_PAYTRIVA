import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/api";
import { auditContext, recordAuditSafe } from "@/lib/audit";
import { db } from "@/lib/db";

const permissionSchema = z.object({
  permissions: z.array(z.string().min(1).max(80)).max(30),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requirePermission("platform:admin");
  if ("response" in access) return access.response;
  const body: unknown = await request.json().catch(() => null);
  const parsed = permissionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Select valid permissions." }, { status: 400 });

  const { id } = await context.params;
  if (id === access.user.id && !parsed.data.permissions.includes("platform:admin")) {
    return NextResponse.json({ error: "You cannot revoke your own platform administrator access." }, { status: 400 });
  }
  const permissions = await db.permission.findMany({
    where: { key: { in: parsed.data.permissions } },
    select: { id: true },
  });
  if (permissions.length !== new Set(parsed.data.permissions).size) {
    return NextResponse.json({ error: "One or more selected permissions are unavailable." }, { status: 400 });
  }
  const user = await db.user.findUnique({ where: { id }, select: { id: true, permissions: { select: { permission: { select: { key: true } } } } } });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
  const previousPermissions = user.permissions.map(({ permission }) => permission.key);

  await db.$transaction([
    db.userPermission.deleteMany({ where: { userId: id } }),
    ...(permissions.length
      ? [
          db.userPermission.createMany({
            data: permissions.map(({ id: permissionId }) => ({
              userId: id,
              permissionId,
              grantedById: access.user.id,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
  const { ip, userAgent } = auditContext(request);
  await recordAuditSafe({ actorId: access.user.id, actorName: access.user.fullName, action: "USER_PERMISSIONS_CHANGED", entityType: "USER", entityId: id, previousValue: { permissions: previousPermissions }, newValue: { permissions: parsed.data.permissions }, ip, userAgent });
  return NextResponse.json({ success: true });
}
