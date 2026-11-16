import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

type AuditClient = Prisma.TransactionClient | typeof db;

export type AuditInput = {
  actorId?: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string | null;
  previousValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  ip?: string | null;
  userAgent?: string | null;
};

/** Extract best-available client network context from a request (behind a trusted proxy). */
export function auditContext(request: Request): { ip: string | null; userAgent: string | null } {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
  const userAgent = request.headers.get("user-agent")?.slice(0, 400) || null;
  return { ip, userAgent };
}

/**
 * Write a centralized audit entry. Pass a transaction client to commit atomically with the
 * action being audited; audit rows are append-only and never updated or deleted by the app.
 */
export async function recordAudit(client: AuditClient, input: AuditInput): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorName: input.actorName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary ?? null,
      previousValue: input.previousValue ?? undefined,
      newValue: input.newValue ?? undefined,
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

/**
 * Best-effort audit write for non-transactional events (e.g. authentication). A logging
 * failure must never break or roll back the primary action, so errors are swallowed and logged.
 */
export async function recordAuditSafe(input: AuditInput): Promise<void> {
  try {
    await recordAudit(db, input);
  } catch (error) {
    console.error("Audit log write failed.", error instanceof Error ? error.message : "unknown error");
  }
}
