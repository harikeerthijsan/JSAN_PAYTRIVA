import { NextRequest, NextResponse } from "next/server";
import { actionUrl, emailDeliveryConfigured, sendActionEmail } from "@/lib/email";
import { db } from "@/lib/db";
import { createOpaqueToken, hashToken } from "@/lib/security";
import { resetRequestSchema } from "@/lib/validation";

const expiryMinutes = Number(process.env.PASSWORD_RESET_EXPIRY_MINUTES ?? 30);
const resetLimit = 3;
const resetWindowMs = 15 * 60 * 1000;

async function recordResetRequest(email: string): Promise<boolean> {
  const key = hashToken(`password-reset:${email}`);
  const now = new Date();
  const previous = await db.loginThrottle.findUnique({ where: { key } });
  if (previous?.blockedUntil && previous.blockedUntil > now) return false;
  const expired = !previous || now.getTime() - previous.windowStarted.getTime() > resetWindowMs;
  const updated = await db.loginThrottle.upsert({
    where: { key },
    create: { key, attempts: 1, windowStarted: now },
    update: expired
      ? { attempts: 1, windowStarted: now, blockedUntil: null }
      : { attempts: { increment: 1 } },
  });
  if (updated.attempts >= resetLimit) {
    await db.loginThrottle.update({
      where: { key },
      data: { blockedUntil: new Date(now.getTime() + resetWindowMs) },
    });
  }
  return updated.attempts <= resetLimit;
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = resetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid employee email address." }, { status: 400 });
  }

  if (process.env.NODE_ENV === "production" && !emailDeliveryConfigured()) {
    return NextResponse.json({ error: "Password recovery is temporarily unavailable." }, { status: 503 });
  }

  const canRequest = await recordResetRequest(parsed.data.email);
  if (!canRequest) {
    return NextResponse.json({
      message: "If an active account matches that email, password recovery instructions have been sent.",
    });
  }

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  let developmentUrl: string | undefined;
  if (user?.isActive && user.passwordHash) {
    const token = createOpaqueToken();
    const resetUrl = actionUrl("/reset-password", token);
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
    const accountToken = await db.accountToken.create({
      data: { userId: user.id, purpose: "PASSWORD_RESET", tokenHash: hashToken(token), expiresAt },
    });
    let delivered: boolean;
    try {
      delivered = await sendActionEmail({
        to: user.email,
        subject: "Reset your PAYTRIVA password",
        actionUrl: resetUrl,
        actionLabel: "Reset password",
      });
    } catch {
      await db.accountToken.delete({ where: { id: accountToken.id } });
      return NextResponse.json({ error: "Password recovery is temporarily unavailable." }, { status: 502 });
    }
    await db.accountToken.updateMany({
      where: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        usedAt: null,
        id: { not: accountToken.id },
      },
      data: { usedAt: new Date() },
    });
    if (!delivered) developmentUrl = resetUrl;
  }

  return NextResponse.json({
    message: "If an active account matches that email, password recovery instructions have been sent.",
    ...(developmentUrl ? { developmentUrl } : {}),
  });
}
