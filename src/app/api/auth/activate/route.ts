import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/security";
import { activateSchema, passwordMeetsPolicy } from "@/lib/validation";
import { auditContext, recordAudit } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = activateSchema.safeParse(body);
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
  const activated = await db.$transaction(async (transaction) => {
    const accountToken = await transaction.accountToken.findFirst({
      where: {
        tokenHash,
        purpose: "ACTIVATION",
        usedAt: null,
        expiresAt: { gt: now },
        invitation: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      },
      include: { invitation: true },
    });
    if (!accountToken?.invitation) return null;

    const consumed = await transaction.accountToken.updateMany({
      where: { id: accountToken.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) return null;

    await transaction.invitation.update({
      where: { id: accountToken.invitation.id },
      data: { acceptedAt: now },
    });
    const user = await transaction.user.update({
      where: { id: accountToken.userId, isActive: false, passwordHash: null },
      data: { passwordHash, activatedAt: now, isActive: true },
    });
    await recordAudit(transaction, {
      actorId: user.id,
      actorName: user.fullName,
      action: "ACCOUNT_ACTIVATED",
      entityType: "USER",
      entityId: user.id,
      summary: "Employee account activated.",
      newValue: { status: "ACTIVE", activatedAt: now.toISOString() },
      ...context,
    });
    return user;
  });

  if (!activated) {
    return NextResponse.json({ error: "This activation link is invalid, expired, or already used." }, { status: 400 });
  }

  await createSession(activated.id);
  return NextResponse.json({ success: true });
}
