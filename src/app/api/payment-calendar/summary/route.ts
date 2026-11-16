import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { loadCurrencyRates } from "@/lib/currency";
import { buildScopeFilter, loadSummary } from "@/lib/payment-calendar";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const scope = buildScopeFilter({ id: auth.user.id, permissions: auth.user.permissions });
  if (!scope) return jsonError("You do not have access to financial summary data.", 403);
  const [summary, currencies] = await Promise.all([loadSummary(scope), loadCurrencyRates()]);
  return NextResponse.json({ ...summary, currencies });
}
