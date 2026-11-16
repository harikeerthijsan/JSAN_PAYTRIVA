import { NextResponse } from "next/server";
import { jsonError, requirePermission } from "@/lib/api";
import { buildReportWhere, fetchReportRecords, parseManagementFilters, type ManagementFilters } from "@/lib/management-reports";
import {
  computeAging,
  computeKpis,
  computeOverdue,
  computeProjectReport,
  computeUpcoming,
  computeVendorReport,
  type ReportRecord,
} from "@/lib/report-calcs";
import { buildExportResponse, type ExportFormat, type ReportColumn, type ReportTable } from "@/lib/report-export";

const REPORT_TYPES = ["summary", "project", "vendor", "aging", "upcoming", "overdue", "history"] as const;
type ReportType = typeof REPORT_TYPES[number];
const EXPORT_FORMATS = new Set<ExportFormat>(["csv", "xlsx", "pdf"]);

function filterSummary(filters: ManagementFilters): string[] {
  const parts: string[] = [];
  if (filters.financialYear) parts.push(`Financial year: FY${filters.financialYear}-${filters.financialYear + 1}`);
  if (filters.from || filters.to) parts.push(`Date range: ${filters.from?.toISOString().slice(0, 10) ?? "…"} to ${filters.to?.toISOString().slice(0, 10) ?? "…"}`);
  if (filters.status) parts.push(`Status: ${filters.status}`);
  if (filters.currency) parts.push(`Currency: ${filters.currency}`);
  if (filters.vendor) parts.push(`Vendor: ${filters.vendor}`);
  return parts.length ? parts : ["No filters applied"];
}

function buildReport(type: ReportType, records: ReportRecord[], now: Date): { json: unknown; columns: ReportColumn[]; rows: ReportTable["rows"]; title: string } {
  switch (type) {
    case "summary": {
      const kpis = computeKpis(records, now);
      const rows = [
        { metric: "Total Open AP", value: kpis.totalOpenAp.usd, count: kpis.totalOpenAp.count },
        { metric: "Due This Week", value: kpis.dueThisWeek.usd, count: kpis.dueThisWeek.count },
        { metric: "Overdue Invoices", value: kpis.overdue.usd, count: kpis.overdue.count },
        { metric: "Total Paid", value: kpis.totalPaid.usd, count: kpis.totalPaid.count },
        { metric: "Pending Approvals", value: kpis.pendingApprovals.usd, count: kpis.pendingApprovals.count },
        { metric: "Approved & Waiting", value: kpis.approvedWaiting.usd, count: kpis.approvedWaiting.count },
        { metric: "Total Outstanding", value: kpis.totalOutstanding.usd, count: kpis.totalOutstanding.count },
        { metric: "Total Payment Requests", value: kpis.totalRequests.usd, count: kpis.totalRequests.count },
      ];
      return { json: kpis, title: "Payment summary", columns: [
        { key: "metric", label: "Metric" }, { key: "value", label: "Value (USD)" }, { key: "count", label: "Invoices" },
      ], rows };
    }
    case "project": {
      const rows = computeProjectReport(records, now);
      return { json: { items: rows }, title: "Project-wise expenditure", columns: [
        { key: "projectName", label: "Project" }, { key: "costCenter", label: "Cost center" }, { key: "totalInvoices", label: "Invoices" },
        { key: "totalRequestedUsd", label: "Requested (USD)" }, { key: "totalApprovedUsd", label: "Approved (USD)" },
        { key: "totalPaidUsd", label: "Paid (USD)" }, { key: "outstandingUsd", label: "Outstanding (USD)" }, { key: "overdueUsd", label: "Overdue (USD)" },
      ], rows };
    }
    case "vendor": {
      const rows = computeVendorReport(records, now);
      return { json: { items: rows }, title: "Vendor-wise payments", columns: [
        { key: "vendorName", label: "Vendor" }, { key: "totalInvoices", label: "Invoices" }, { key: "totalInvoiceValueUsd", label: "Invoice value (USD)" },
        { key: "totalPaidUsd", label: "Paid (USD)" }, { key: "pendingPaymentsUsd", label: "Pending (USD)" }, { key: "overduePaymentsUsd", label: "Overdue (USD)" },
        { key: "lastPaymentDate", label: "Last payment" },
      ], rows };
    }
    case "aging": {
      const aging = computeAging(records, now);
      return { json: aging, title: "Approval aging report", columns: [
        { key: "transactionId", label: "Transaction ID" }, { key: "vendorName", label: "Vendor" }, { key: "invoiceNumber", label: "Invoice" },
        { key: "projectName", label: "Project" }, { key: "invoiceValueUsd", label: "Value (USD)" }, { key: "approverName", label: "Approver" },
        { key: "submittedAt", label: "Submitted" }, { key: "pendingSince", label: "Pending since" }, { key: "pendingHours", label: "Hours" },
        { key: "bucket", label: "Aging" }, { key: "status", label: "Status" },
      ], rows: aging.rows };
    }
    case "upcoming": {
      const upcoming = computeUpcoming(records, now);
      return { json: upcoming, title: "Upcoming payments", columns: [
        { key: "scheduledDate", label: "Scheduled date" }, { key: "transactionId", label: "Transaction ID" }, { key: "vendorName", label: "Vendor" },
        { key: "projectName", label: "Project" }, { key: "invoiceValueUsd", label: "Value (USD)" },
      ], rows: upcoming.rows };
    }
    case "overdue": {
      const overdue = computeOverdue(records, now);
      return { json: overdue, title: "Overdue invoices", columns: [
        { key: "transactionId", label: "Transaction ID" }, { key: "vendorName", label: "Vendor" }, { key: "projectName", label: "Project" },
        { key: "invoiceValueUsd", label: "Value (USD)" }, { key: "dueDate", label: "Due date" }, { key: "daysOverdue", label: "Days overdue" }, { key: "status", label: "Status" },
      ], rows: overdue.rows };
    }
    case "history": {
      const rows = records.map((record) => ({
        transactionId: record.transactionId,
        vendorName: record.vendorName,
        invoiceNumber: record.invoiceNumber,
        projectName: record.projectName ?? "—",
        status: record.status,
        finalValueUsd: record.finalValueUsd ? String(record.finalValueUsd) : "0",
        currencyCode: record.currencyCode,
        submittedAt: record.submittedAt ? record.submittedAt.toISOString().slice(0, 10) : null,
        dueDate: record.dueDate ? record.dueDate.toISOString().slice(0, 10) : null,
        scheduledDate: record.scheduledDate ? record.scheduledDate.toISOString().slice(0, 10) : null,
        paidUsd: record.paidUsd ? String(record.paidUsd) : null,
        actualPaymentDate: record.actualPaymentDate ? record.actualPaymentDate.toISOString().slice(0, 10) : null,
      }));
      return { json: { items: rows, total: rows.length }, title: "Historical payment transactions", columns: [
        { key: "transactionId", label: "Transaction ID" }, { key: "vendorName", label: "Vendor" }, { key: "invoiceNumber", label: "Invoice" },
        { key: "projectName", label: "Project" }, { key: "status", label: "Status" }, { key: "finalValueUsd", label: "Value (USD)" },
        { key: "currencyCode", label: "Currency" }, { key: "submittedAt", label: "Submitted" }, { key: "dueDate", label: "Due date" },
        { key: "scheduledDate", label: "Scheduled" }, { key: "actualPaymentDate", label: "Paid on" },
      ], rows };
    }
  }
}

export async function GET(request: Request, context: { params: Promise<{ type: string }> }) {
  const auth = await requirePermission("reports:access");
  if ("response" in auth) return auth.response;
  const { type } = await context.params;
  if (!REPORT_TYPES.includes(type as ReportType)) return jsonError("Unknown report type.", 404);
  const parsed = parseManagementFilters(new URL(request.url));
  if ("error" in parsed) return jsonError(parsed.error, 400);
  const { filters } = parsed;
  const formatRaw = new URL(request.url).searchParams.get("format");
  if (formatRaw && !EXPORT_FORMATS.has(formatRaw as ExportFormat)) return jsonError("Export format must be csv, xlsx, or pdf.", 400);

  const now = new Date();
  const { records, capped } = await fetchReportRecords(buildReportWhere(filters));
  const report = buildReport(type as ReportType, records, now);

  if (formatRaw) {
    const table: ReportTable = {
      title: `PAYTRIVA · ${report.title}`,
      columns: report.columns,
      rows: report.rows,
      meta: { generatedAt: now.toISOString(), filters: filterSummary(filters) },
    };
    return buildExportResponse(formatRaw as ExportFormat, `paytriva-${type}-${now.toISOString().slice(0, 10)}`, table);
  }

  return NextResponse.json({ generatedAt: now.toISOString(), type, ...(report.json as object), capped });
}
