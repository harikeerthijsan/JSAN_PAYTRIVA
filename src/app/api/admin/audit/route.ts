import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const access = await requirePermission("platform:admin");
  if ("response" in access) return access.response;

  const params = request.nextUrl.searchParams;
  const requestedPage = Number(params.get("page") ?? 1);
  const requestedPageSize = Number(params.get("pageSize") ?? 25);
  const page = Number.isSafeInteger(requestedPage) ? Math.min(1_000_000, Math.max(1, requestedPage)) : 1;
  const pageSize = Number.isSafeInteger(requestedPageSize) ? Math.min(100, Math.max(1, requestedPageSize)) : 25;
  const search = params.get("search")?.trim().slice(0, 120) ?? "";
  const action = params.get("action")?.trim().slice(0, 80) ?? "";
  const fromValue = params.get("from");
  const toValue = params.get("to");
  const from = fromValue ? new Date(fromValue) : undefined;
  const to = toValue ? new Date(toValue) : undefined;

  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return NextResponse.json({ error: "Enter a valid audit date range." }, { status: 400 });
  }
  if (from && to && from > to) {
    return NextResponse.json({ error: "The start date must be before the end date." }, { status: 400 });
  }

  const where = {
    ...(action ? { action: { contains: action, mode: "insensitive" as const } } : {}),
    ...(search
      ? {
          OR: [
            { actorName: { contains: search, mode: "insensitive" as const } },
            { entityType: { contains: search, mode: "insensitive" as const } },
            { entityId: { contains: search, mode: "insensitive" as const } },
            { summary: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
  };
  const [total, entries] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        actorId: true,
        actorName: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        previousValue: true,
        newValue: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
      },
    }),
  ]);
  return NextResponse.json({ entries, total, page, pageSize });
}
