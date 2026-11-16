import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { auditContext, recordAuditSafe } from "@/lib/audit";
import { db } from "@/lib/db";
import { createThrottleKey } from "@/lib/security";
import { loginSchema } from "@/lib/validation";

const dummyPasswordHash =
  "$2a$12$4TgL3EefYtTfOp2bmn7SwuN9fWYQY1pvOL2obC1h/SMIlnyV7yTbW";
const maxAttempts = 5;
const lockoutMs = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address and password." }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const { ip, userAgent } = auditContext(request);
  const key = createThrottleKey(email, "account");
  const throttle = await db.loginThrottle.findUnique({ where: { key } });
  const now = new Date();
  const locked = Boolean(throttle?.blockedUntil && throttle.blockedUntil > now);
  const user = await db.user.findUnique({
    where: { email },
    include: { roles: { include: { role: true } } },
  });
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? dummyPasswordHash);
  const valid = passwordMatches && Boolean(user?.passwordHash && user.isActive && user.activatedAt);

  if (valid && user) {
    await db.loginThrottle.deleteMany({ where: { key } });
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
    await createSession(user.id, parsed.data.rememberMe);
    await recordAuditSafe({ actorId: user.id, actorName: user.fullName, action: "LOGIN_SUCCESS", entityType: "AUTH", entityId: user.id, ip, userAgent });
    return NextResponse.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        roles: user.roles.map(({ role }) => ({ key: role.key, name: role.name })),
      },
    });
  }

  if (locked) {
    await recordAuditSafe({ actorId: user?.id ?? null, actorName: email, action: "LOGIN_BLOCKED", entityType: "AUTH", entityId: user?.id ?? email, summary: "Login blocked by rate limit.", ip, userAgent });
    return NextResponse.json(
      { error: "Too many unsuccessful attempts. Try again later." },
      { status: 429 },
    );
  }

  const expiredWindow = !throttle || now.getTime() - throttle.windowStarted.getTime() > lockoutMs;
  const updatedThrottle = await db.loginThrottle.upsert({
    where: { key },
    create: { key, attempts: 1, windowStarted: now },
    update: {
      ...(expiredWindow
        ? { attempts: 1, windowStarted: now, blockedUntil: null }
        : { attempts: { increment: 1 } }),
    },
  });
  if (updatedThrottle.attempts >= maxAttempts) {
    await db.loginThrottle.update({
      where: { key },
      data: { blockedUntil: new Date(now.getTime() + lockoutMs) },
    });
  }
  await recordAuditSafe({ actorId: user?.id ?? null, actorName: email, action: "LOGIN_FAILED", entityType: "AUTH", entityId: user?.id ?? email, summary: "Invalid credentials.", ip, userAgent });
  return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
}
