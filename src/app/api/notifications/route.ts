import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError, requireUser } from "@/lib/api";
import { notificationCategories } from "@/lib/notification-settings";

function validDate(value: string | null): boolean {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime()) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const category = url.searchParams.get("type");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (category && !notificationCategories.includes(category as typeof notificationCategories[number])) return jsonError("Select a valid notification type.", 400);
  if (!validDate(from) || !validDate(to)) return jsonError("Date filters must be valid calendar dates.", 400);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));
  const where = {
    userId: auth.user.id,
    ...(category ? { category } : {}),
    ...(url.searchParams.get("unread") === "true" ? { readAt: null } : {}),
    ...(from || to ? {
      createdAt: {
        ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
      },
    } : {}),
  };
  const [items, total, unread] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, title: true, message: true, href: true, category: true, createdAt: true, readAt: true },
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { userId: auth.user.id, readAt: null } }),
  ]);
  return NextResponse.json({ items, unread, total, page, pageSize, pages: Math.ceil(total / pageSize), timeZone: auth.user.timeZone });
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }
  const parsed = z.object({ id: z.string().optional(), all: z.boolean().optional() }).safeParse(body);
  if (!parsed.success || (!parsed.data.id && parsed.data.all !== true)) return jsonError("Choose a notification to mark as read.", 400);
  await db.notification.updateMany({
    where: { userId: auth.user.id, ...(parsed.data.id ? { id: parsed.data.id } : { readAt: null }) },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
