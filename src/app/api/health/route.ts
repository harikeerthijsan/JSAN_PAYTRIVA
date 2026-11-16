import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Liveness/readiness probe for load balancers and uptime monitors. Unauthenticated by
// design, but it exposes no business or configuration data — only coarse service status.
export async function GET() {
  const startedAt = Date.now();
  let database = false;
  try {
    await db.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  const body = {
    status: database ? "ok" : "degraded",
    checks: { database },
    timestamp: new Date().toISOString(),
    responseMs: Date.now() - startedAt,
  };
  return NextResponse.json(body, { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
