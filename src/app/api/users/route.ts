import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import { createEmployeeSchema } from "@/lib/validation";
import { auditContext, recordAudit } from "@/lib/audit";

// Extra, directly-grantable permissions offered when creating or editing an employee.
// Base role capabilities (ap:access, approvals:access, payments:read_all, etc.) come from
// the assigned role; these are the additive, admin-controlled grants.
export const GRANTABLE_PERMISSIONS = [
  "reports:access",
  "platform:admin",
  "payments:manage_masters",
  "payments:correct",
  "payments:read_payment_account",
  "payments:read_payment_proof",
] as const;

export async function GET(request: NextRequest) {
  const access = await requirePermission("users:read");
  if ("response" in access) return access.response;

  const params = request.nextUrl.searchParams;
  const search = params.get("search")?.trim().slice(0, 120) ?? "";
  const status = params.get("status") ?? "all";
  const roleKey = params.get("role") ?? "";
  const requestedPage = Number(params.get("page") ?? 1);
  const requestedPageSize = Number(params.get("pageSize") ?? 10);
  const page = Number.isSafeInteger(requestedPage) ? Math.min(1_000_000, Math.max(1, requestedPage)) : 1;
  const pageSize = Number.isSafeInteger(requestedPageSize)
    ? Math.min(50, Math.max(1, requestedPageSize))
    : 10;
  const where = {
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(status === "active" ? { isActive: true } : {}),
    ...(status === "inactive" ? { isActive: false } : {}),
    ...(roleKey ? { roles: { some: { role: { key: roleKey } } } } : {}),
  };
  const canManagePermissions = access.user.permissions.includes("platform:admin");
  const [total, users, roles, permissionCatalog] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        fullName: true,
        email: true,
        isActive: true,
        activatedAt: true,
        createdAt: true,
        lastLoginAt: true,
        roles: { select: { role: { select: { key: true, name: true } } } },
        permissions: { select: { permission: { select: { key: true } } } },
      },
    }),
    db.role.findMany({ orderBy: { name: "asc" }, select: { key: true, name: true } }),
    db.permission.findMany({ where: { key: { in: [...GRANTABLE_PERMISSIONS] } }, select: { key: true, description: true } }),
  ]);
  return NextResponse.json({
    users: users.map(({ permissions, ...user }) => ({
      ...user,
      permissions: permissions.map(({ permission }) => permission.key),
    })),
    roles,
    availablePermissions: permissionCatalog,
    canManagePermissions,
    total,
    page,
    pageSize,
    currentUserId: access.user.id,
  });
}

export async function POST(request: NextRequest) {
  const access = await requirePermission("users:invite");
  if ("response" in access) return access.response;
  if (!access.user.permissions.includes("users:assign_role")) {
    return NextResponse.json({ error: "You do not have permission to assign roles." }, { status: 403 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = createEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Please check the submitted information and try again." }, { status: 400 });
  }
  const { fullName, email, roleKey, password } = parsed.data;

  // Only platform administrators may grant additional permissions.
  const requestedPermissions = (parsed.data.permissions ?? []).filter((key) => (GRANTABLE_PERMISSIONS as readonly string[]).includes(key));
  if (requestedPermissions.length && !access.user.permissions.includes("platform:admin")) {
    return NextResponse.json({ error: "Only a platform administrator may grant additional permissions." }, { status: 403 });
  }

  const role = await db.role.findUnique({ where: { key: roleKey } });
  if (!role) return NextResponse.json({ error: "The selected role is unavailable." }, { status: 400 });

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return NextResponse.json({ error: "An employee with this email already exists." }, { status: 409 });

  const permissions = requestedPermissions.length
    ? await db.permission.findMany({ where: { key: { in: requestedPermissions } }, select: { id: true } })
    : [];

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  const context = auditContext(request);
  try {
    const created = await db.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: { fullName, email, passwordHash, isActive: true, activatedAt: now },
        select: { id: true, fullName: true },
      });
      await transaction.userRole.create({ data: { userId: user.id, roleId: role.id, assignedById: access.user.id } });
      if (permissions.length) {
        await transaction.userPermission.createMany({
          data: permissions.map(({ id }) => ({ userId: user.id, permissionId: id, grantedById: access.user.id })),
          skipDuplicates: true,
        });
      }
      await recordAudit(transaction, {
        actorId: access.user.id,
        actorName: access.user.fullName,
        action: "USER_CREATED",
        entityType: "USER",
        entityId: user.id,
        summary: `Created ${user.fullName} as ${role.name}.`,
        newValue: { fullName, email, role: role.key, permissions: requestedPermissions, status: "ACTIVE" },
        ...context,
      });
      return user;
    });
    return NextResponse.json({ message: `${created.fullName} can now sign in.`, id: created.id }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "An employee with this email already exists." }, { status: 409 });
    }
    throw error;
  }
}
