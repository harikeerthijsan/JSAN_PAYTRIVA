import { NextResponse } from "next/server";
import { jsonError, requirePermission } from "@/lib/api";
import {
  buildReportWhere,
  fetchReportRecords,
  loadFilterOptions,
  parseManagementFilters,
} from "@/lib/management-reports";
import {
  computeCurrencyReport,
  computeKpis,
  computeProjectReport,
  computeStatusDistribution,
  computeTrends,
  previousPeriod,
} from "@/lib/report-calcs";

export async function GET(request: Request) {
  const auth = await requirePermission("reports:access");
  if ("response" in auth) return auth.response;
  const parsed = parseManagementFilters(new URL(request.url));
  if ("error" in parsed) return jsonError(parsed.error, 400);
  const { filters } = parsed;
  const now = new Date();

  const { records, capped } = await fetchReportRecords(buildReportWhere(filters));

  // Previous equal-length period for KPI comparison (only when an explicit range is set).
  let previous = null;
  if (filters.from && filters.to) {
    const prevRange = previousPeriod(filters.from, filters.to);
    const prev = await fetchReportRecords(buildReportWhere(filters, prevRange));
    previous = computeKpis(prev.records, now);
  }

  const [options] = await Promise.all([loadFilterOptions()]);

  return NextResponse.json({
    generatedAt: now.toISOString(),
    filters: {
      from: filters.from ? filters.from.toISOString().slice(0, 10) : null,
      to: filters.to ? filters.to.toISOString().slice(0, 10) : null,
      financialYear: filters.financialYear,
      projectId: filters.projectId,
      costCenterId: filters.costCenterId,
      vendor: filters.vendor,
      currency: filters.currency,
      approverId: filters.approverId,
      entityId: filters.entityId,
      status: filters.status,
    },
    kpis: computeKpis(records, now),
    previousKpis: previous,
    statusDistribution: computeStatusDistribution(records),
    trends: computeTrends(records, now, 12),
    currency: computeCurrencyReport(records),
    projects: computeProjectReport(records, now).slice(0, 8),
    options,
    capped,
  });
}
