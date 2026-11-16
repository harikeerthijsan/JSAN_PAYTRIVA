import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { loadLiveDashboardRates } from "@/lib/live-dashboard-rates";

export async function GET() {
  const authenticated = await requireUser();
  if ("response" in authenticated) return authenticated.response;
  return NextResponse.json(await loadLiveDashboardRates(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
