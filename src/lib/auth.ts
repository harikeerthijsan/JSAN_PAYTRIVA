import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { hashToken, createOpaqueToken } from "@/lib/security";

export const SESSION_COOKIE = "paytriva_session";
const sessionDurationDays = Number(process.env.SESSION_DURATION_DAYS ?? 7);

export async function createSession(userId: string, rememberMe = true): Promise<void> {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + sessionDurationDays * 24 * 60 * 60 * 1000);
  await db.authSession.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(rememberMe ? { expires: expiresAt } : {}),
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          roles: { include: { role: true } },
          permissions: { include: { permission: true } },
        },
      },
    },
  });

  if (!session || session.expiresAt <= new Date() || !session.user.isActive) {
    if (session) await db.authSession.delete({ where: { id: session.id } });
    // This helper also runs in Server Components, where cookie mutation is not allowed.
    return null;
  }

  const rolePermissions = await db.rolePermission.findMany({
    where: { roleId: { in: session.user.roles.map(({ roleId }) => roleId) } },
    select: { permission: { select: { key: true } } },
  });
  const permissionKeys = new Set([
    ...rolePermissions.map(({ permission }) => permission.key),
    ...session.user.permissions.map(({ permission }) => permission.key),
  ]);

  return {
    id: session.user.id,
    fullName: session.user.fullName,
    email: session.user.email,
    timeZone: session.user.timeZone,
    roles: session.user.roles.map(({ role }) => ({
      key: role.key,
      name: role.name,
    })),
    permissions: [...permissionKeys],
  };
}

export async function userHasPermission(permission: string): Promise<boolean> {
  const user = await getCurrentUser();
  return user?.permissions.includes(permission) ?? false;
}
