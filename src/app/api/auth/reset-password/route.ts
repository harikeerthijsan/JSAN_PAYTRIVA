import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/security";
import { resetPasswordSchema, passwordMeetsPolicy } from "@/lib/validation";
import { auditContext, recordAudit } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success || !passwordMeetsPolicy(parsed.data?.password ?? "")) {
    return NextResponse.json(
      { error: "Choose a password with at least 12 characters, including uppercase, lowercase, a number, and a symbol." },
      { status: 400 },
    );
  }

  const { token, password } = parsed.data;
  const tokenHash = hashToken(token);
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  const context = auditContext(request);
  const reset = await db.$transaction(async (transaction) => {
    const accountToken = await transaction.accountToken.findFirst({
      where: { tokenHash, purpose: "PASSWORD_RESET", usedAt: null, expiresAt: { gt: now } },
    });
    if (!accountToken) return false;
    const consumed = await transaction.accountToken.updateMany({
      where: { id: accountToken.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) return false;
    const user = await transaction.user.update({
      where: { id: accountToken.userId, isActive: true },
      data: { passwordHash },
    });
    await recordAudit(transaction, {
      actorId: user.id,
      actorName: user.fullName,
      action: "PASSWORD_RESET",
      entityType: "USER",
      entityId: user.id,
      summary: "Employee password reset completed.",
      newValue: { passwordResetAt: now.toISOString() },
      ...context,
    });
    await transaction.authSession.deleteMany({ where: { userId: accountToken.userId } });
    await transaction.accountToken.updateMany({
      where: {
        userId: accountToken.userId,
        purpose: "PASSWORD_RESET",
        usedAt: null,
      },
      data: { usedAt: now },
    });
    return true;
  });

  if (!reset) {
    return NextResponse.json({ error: "This password-reset link is invalid, expired, or already used." }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
