import { NextResponse } from "next/server";
import { destroySession, getCurrentUser } from "@/lib/auth";
import { auditContext, recordAuditSafe } from "@/lib/audit";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  await destroySession();
  if (user) {
    const { ip, userAgent } = auditContext(request);
    await recordAuditSafe({ actorId: user.id, actorName: user.fullName, action: "LOGOUT", entityType: "AUTH", entityId: user.id, ip, userAgent });
  }
  return NextResponse.json({ success: true });
}
