import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { buildScopeFilter, loadCalendar } from "@/lib/payment-calendar";
import type { PaymentTrackingCategory } from "@/lib/payment-scheduling";

const categories = new Set<PaymentTrackingCategory>(["COMPLETED", "OVERDUE", "AT_RISK", "DUE_THIS_WEEK", "UPCOMING", "UNSCHEDULED"]);

function parseDay(value: string | null): Date | null | "invalid" {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "invalid";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return "invalid";
  return date;
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const scope = buildScopeFilter({ id: auth.user.id, permissions: auth.user.permissions });
  if (!scope) return jsonError("You do not have access to payment calendar data.", 403);

  const url = new URL(request.url);
  const from = parseDay(url.searchParams.get("from"));
  const to = parseDay(url.searchParams.get("to"));
  if (from === "invalid" || to === "invalid") return jsonError("Date filters must be valid calendar dates.", 400);
  const toEnd = to ? new Date(to.getTime() + 86_399_999) : null;
  const categoryParam = url.searchParams.get("category");
  if (categoryParam && !categories.has(categoryParam as PaymentTrackingCategory)) return jsonError("Select a valid payment category.", 400);

  const result = await loadCalendar(scope, {
    from,
    to: toEnd,
    vendor: url.searchParams.get("vendor")?.trim().slice(0, 100) || null,
    projectId: url.searchParams.get("projectId") || null,
    category: (categoryParam as PaymentTrackingCategory | null) ?? null,
  });
  return NextResponse.json(result);
}
