"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Download, RotateCw } from "lucide-react";
import { CurrencySwitcher } from "@/components/currency-switcher";

type KpiValue = { usd: string; count: number };
type Kpis = {
  totalOpenAp: KpiValue; dueThisWeek: KpiValue; overdue: KpiValue; totalPaid: KpiValue;
  pendingApprovals: KpiValue; approvedWaiting: KpiValue; totalOutstanding: KpiValue; totalRequests: KpiValue;
};
type Options = {
  projects: { id: string; name: string }[];
  costCenters: { id: string; code: string; name: string }[];
  currencies: { code: string; name: string; symbol: string; usdPerUnit: string | null }[];
  entities: { id: string; name: string }[];
  approvers: { id: string; fullName: string }[];
  statuses: string[];
};
type Dashboard = {
  generatedAt: string;
  kpis: Kpis;
  previousKpis: Kpis | null;
  statusDistribution: { status: string; count: number }[];
  trends: { month: string; requests: number; approvedCount: number; completedCount: number }[];
  currency: { code: string; count: number; totalOriginal: string; totalUsd: string }[];
  projects: { projectId: string | null; projectName: string; totalRequestedUsd: string }[];
  options: Options;
  capped: boolean;
};

type Filters = {
  from: string; to: string; fy: string; projectId: string; costCenterId: string;
  currency: string; status: string; approverId: string; entityId: string; vendor: string;
};
const EMPTY: Filters = { from: "", to: "", fy: "", projectId: "", costCenterId: "", currency: "", status: "", approverId: "", entityId: "", vendor: "" };

// USD figures are converted to the chosen display currency at its latest rate (usdPerUnit = USD per 1 unit).
const formatMoney = (value: string | number, symbol: string, usdPerUnit: string | number) =>
  `${symbol}${(Number(value) / (Number(usdPerUnit) || 1)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: "Pending Review", UNDER_REVIEW: "Under Review", PENDING_APPROVAL: "Pending Approval",
  RETURNED: "Returned", NEEDS_INFORMATION: "Clarification", APPROVED: "Approved & Waiting", REJECTED: "Rejected", PAID: "Paid",
};

type ReportTab = "aging" | "project" | "vendor" | "upcoming" | "overdue" | "history";
const REPORT_TABS: { key: ReportTab; label: string }[] = [
  { key: "aging", label: "Approval aging" }, { key: "project", label: "Projects" }, { key: "vendor", label: "Vendors" },
  { key: "upcoming", label: "Upcoming" }, { key: "overdue", label: "Overdue" }, { key: "history", label: "History" },
];
const REPORT_COLUMNS: Record<ReportTab, { key: string; label: string; money?: boolean }[]> = {
  aging: [
    { key: "transactionId", label: "Transaction" }, { key: "vendorName", label: "Vendor" }, { key: "projectName", label: "Project" },
    { key: "invoiceValueUsd", label: "Value (USD)", money: true }, { key: "approverName", label: "Approver" }, { key: "pendingHours", label: "Hours" }, { key: "bucket", label: "Aging" },
  ],
  project: [
    { key: "projectName", label: "Project" }, { key: "costCenter", label: "Cost center" }, { key: "totalInvoices", label: "Invoices" },
    { key: "totalRequestedUsd", label: "Requested", money: true }, { key: "totalApprovedUsd", label: "Approved", money: true },
    { key: "totalPaidUsd", label: "Paid", money: true }, { key: "outstandingUsd", label: "Outstanding", money: true }, { key: "overdueUsd", label: "Overdue", money: true },
  ],
  vendor: [
    { key: "vendorName", label: "Vendor" }, { key: "totalInvoices", label: "Invoices" }, { key: "totalInvoiceValueUsd", label: "Invoice value", money: true },
    { key: "totalPaidUsd", label: "Paid", money: true }, { key: "pendingPaymentsUsd", label: "Pending", money: true }, { key: "overduePaymentsUsd", label: "Overdue", money: true }, { key: "lastPaymentDate", label: "Last payment" },
  ],
  upcoming: [
    { key: "scheduledDate", label: "Scheduled" }, { key: "transactionId", label: "Transaction" }, { key: "vendorName", label: "Vendor" },
    { key: "projectName", label: "Project" }, { key: "invoiceValueUsd", label: "Value (USD)", money: true },
  ],
  overdue: [
    { key: "transactionId", label: "Transaction" }, { key: "vendorName", label: "Vendor" }, { key: "projectName", label: "Project" },
    { key: "invoiceValueUsd", label: "Value (USD)", money: true }, { key: "dueDate", label: "Due date" }, { key: "daysOverdue", label: "Days overdue" },
  ],
  history: [
    { key: "transactionId", label: "Transaction" }, { key: "vendorName", label: "Vendor" }, { key: "projectName", label: "Project" },
    { key: "status", label: "Status" }, { key: "finalValueUsd", label: "Value (USD)", money: true }, { key: "submittedAt", label: "Submitted" }, { key: "actualPaymentDate", label: "Paid on" },
  ],
};
const REPORT_ROWS_KEY: Record<ReportTab, string> = { aging: "rows", project: "items", vendor: "items", upcoming: "rows", overdue: "rows", history: "items" };

function TrendChart({ data }: { data: Dashboard["trends"] }) {
  const max = Math.max(1, ...data.flatMap((month) => [month.requests, month.approvedCount, month.completedCount]));
  const barW = 5, gap = 3, groupW = barW * 3 + gap * 2 + 10, height = 120;
  const series = [["requests", "#2563eb"], ["approvedCount", "#237a61"], ["completedCount", "#7c3aed"]] as const;
  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${data.length * groupW + 10} ${height + 24}`} className="trend-chart" role="img" aria-label="Monthly payment trends">
        {data.map((month, index) => (
          <g key={month.month} transform={`translate(${index * groupW + 8}, 0)`}>
            {series.map(([key, color], seriesIndex) => {
              const value = month[key];
              const barHeight = (value / max) * height;
              return <rect key={key} x={seriesIndex * (barW + gap)} y={height - barHeight} width={barW} height={barHeight} rx={1.5} fill={color} />;
            })}
            <text x={(barW * 3 + gap * 2) / 2} y={height + 14} textAnchor="middle" className="chart-axis">{month.month.slice(5)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function BarList({ items }: { items: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  if (!items.length) return <p className="calendar-note">No data for the selected filters.</p>;
  return (
    <ul className="bar-list">
      {items.map((item) => (
        <li key={item.label}>
          <div className="bar-list-head"><span>{item.label}</span><strong>{item.sub ?? item.value.toLocaleString()}</strong></div>
          <div className="bar-track"><span style={{ width: `${(item.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function ManagementDashboard({ userName }: { userName: string }) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [reportTab, setReportTab] = useState<ReportTab>("aging");
  const [report, setReport] = useState<{ rows: Record<string, unknown>[]; extra: Record<string, unknown> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState("USD");

  // Currencies that have a usable rate (USD base, plus any with a configured exchange rate).
  const convertibleCurrencies = useMemo(
    () => (dashboard?.options.currencies ?? []).filter((currency) => currency.usdPerUnit !== null),
    [dashboard],
  );
  const selectedCurrency = useMemo(
    () => convertibleCurrencies.find((currency) => currency.code === displayCurrency)
      ?? { code: "USD", name: "US Dollar", symbol: "$", usdPerUnit: "1" },
    [convertibleCurrencies, displayCurrency],
  );
  const money = useCallback(
    (value: string | number) => formatMoney(value, selectedCurrency.symbol, selectedCurrency.usdPerUnit ?? "1"),
    [selectedCurrency],
  );

  const qs = useCallback(() => {
    const params = new URLSearchParams();
    (Object.entries(filters) as [keyof Filters, string][]).forEach(([key, value]) => { if (value) params.set(key, value); });
    return params.toString();
  }, [filters]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/management/dashboard?${qs()}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load the dashboard.");
      setDashboard(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load the dashboard.");
    } finally {
      setLoading(false);
    }
  }, [qs]);

  const loadReport = useCallback(async (tab: ReportTab) => {
    setReportLoading(true);
    try {
      const response = await fetch(`/api/management/reports/${tab}?${qs()}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load the report.");
      const rowsKey = REPORT_ROWS_KEY[tab];
      setReport({ rows: (result[rowsKey] as Record<string, unknown>[]) ?? [], extra: result });
    } catch {
      setReport({ rows: [], extra: {} });
    } finally {
      setReportLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadDashboard(); void loadReport(reportTab); }, 0);
    return () => window.clearTimeout(timer);
    // Intentionally run once on mount and when Apply updates the applied filters via loadDashboard identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply() { void loadDashboard(); void loadReport(reportTab); }
  function reset() { setFilters(EMPTY); }
  function selectReport(tab: ReportTab) { setReportTab(tab); void loadReport(tab); }

  const options = dashboard?.options;
  const kpis = dashboard?.kpis;
  const prev = dashboard?.previousKpis;

  const kpiCards = useMemo(() => kpis ? [
    { label: "Total Open AP", data: kpis.totalOpenAp, tab: "history" as ReportTab, flow: false },
    { label: "Due This Week", data: kpis.dueThisWeek, tab: "upcoming" as ReportTab, flow: false },
    { label: "Overdue Invoices", data: kpis.overdue, tab: "overdue" as ReportTab, flow: false, alert: true },
    { label: "Total Paid", data: kpis.totalPaid, tab: "history" as ReportTab, flow: true, prev: prev?.totalPaid },
    { label: "Pending Approvals", data: kpis.pendingApprovals, tab: "aging" as ReportTab, flow: false },
    { label: "Approved & Waiting", data: kpis.approvedWaiting, tab: "upcoming" as ReportTab, flow: false },
    { label: "Total Outstanding", data: kpis.totalOutstanding, tab: "project" as ReportTab, flow: false },
    { label: "Total Payment Requests", data: kpis.totalRequests, tab: "history" as ReportTab, flow: true, prev: prev?.totalRequests },
  ] : [], [kpis, prev]);

  const columns = REPORT_COLUMNS[reportTab];
  const exportHref = (format: string) => `/api/management/reports/${reportTab}?${qs()}${qs() ? "&" : ""}format=${format}`;

  return (
    <div className="payment-page management-page">
      <div className="page-heading payment-heading">
        <div>
          <span className="eyebrow">MANAGEMENT</span>
          <h1>Financial dashboard</h1>
          <p>Consolidated AP, approval, and payment intelligence for JSAN leadership. Figures are computed in USD and shown in your chosen display currency.</p>
        </div>
        <div className="management-head-actions">
          <CurrencySwitcher currencies={dashboard?.options.currencies ?? []} value={displayCurrency} onChange={setDisplayCurrency} />
          <button className="button button-secondary" onClick={apply}><RotateCw size={15} /> Refresh</button>
        </div>
      </div>

      <section className="panel management-filters">
        <div className="management-filter-grid">
          <label className="payment-field"><span>From</span><input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
          <label className="payment-field"><span>To</span><input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
          <label className="payment-field"><span>Financial year</span><select value={filters.fy} onChange={(event) => setFilters({ ...filters, fy: event.target.value })}><option value="">Any</option>{[2024, 2025, 2026, 2027].map((year) => <option key={year} value={year}>FY{year}-{year + 1}</option>)}</select></label>
          <label className="payment-field"><span>Project</span><select value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}><option value="">All</option>{options?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label className="payment-field"><span>Cost center</span><select value={filters.costCenterId} onChange={(event) => setFilters({ ...filters, costCenterId: event.target.value })}><option value="">All</option>{options?.costCenters.map((cc) => <option key={cc.id} value={cc.id}>{cc.code} — {cc.name}</option>)}</select></label>
          <label className="payment-field"><span>Vendor</span><input value={filters.vendor} onChange={(event) => setFilters({ ...filters, vendor: event.target.value })} placeholder="Search vendor" /></label>
          <label className="payment-field"><span>Status</span><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All</option>{options?.statuses.map((status) => <option key={status} value={status}>{STATUS_LABELS[status] ?? status}</option>)}</select></label>
          <label className="payment-field"><span>Currency</span><select value={filters.currency} onChange={(event) => setFilters({ ...filters, currency: event.target.value })}><option value="">All</option>{options?.currencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.code}</option>)}</select></label>
          <label className="payment-field"><span>Approver</span><select value={filters.approverId} onChange={(event) => setFilters({ ...filters, approverId: event.target.value })}><option value="">All</option>{options?.approvers.map((approver) => <option key={approver.id} value={approver.id}>{approver.fullName}</option>)}</select></label>
          <label className="payment-field"><span>JSAN entity</span><select value={filters.entityId} onChange={(event) => setFilters({ ...filters, entityId: event.target.value })}><option value="">All</option>{options?.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
        </div>
        <div className="management-filter-actions">
          <button className="button button-primary" onClick={apply}>Apply filters</button>
          <button className="button button-secondary" onClick={reset}>Reset</button>
        </div>
      </section>

      {error && <div className="payment-alert" role="alert">{error}</div>}
      {loading && <p>Loading dashboard…</p>}

      {!loading && kpis && (
        <>
          <div className="kpi-grid">
            {kpiCards.map((card) => {
              const delta = card.flow && card.prev ? card.data.count - card.prev.count : null;
              return (
                <button className={`kpi-card${card.alert && card.data.count > 0 ? " kpi-alert" : ""}`} key={card.label} onClick={() => selectReport(card.tab)}>
                  <span className="kpi-label">{card.label}</span>
                  <strong className="kpi-value">{money(card.data.usd)}</strong>
                  <div className="kpi-foot">
                    <span>{card.data.count} invoice{card.data.count === 1 ? "" : "s"}</span>
                    {delta !== null && (
                      <span className={`kpi-delta ${delta >= 0 ? "up" : "down"}`}>{delta >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(delta)} vs prev</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {selectedCurrency.code !== "USD" && (
            <p className="calendar-note">Shown in {selectedCurrency.code} ({selectedCurrency.symbol}), converted from the USD reporting currency at the latest rate (${Number(selectedCurrency.usdPerUnit).toLocaleString("en-US", { maximumFractionDigits: 6 })} per 1 {selectedCurrency.code}). Figures are indicative.</p>
          )}

          <div className="chart-grid">
            <section className="panel chart-card">
              <div className="panel-heading"><div><h2>Payment trends</h2><p>Requests, approvals, and completed payments by month.</p></div></div>
              <TrendChart data={dashboard.trends} />
              <div className="chart-legend"><span><i style={{ background: "#2563eb" }} /> Requests</span><span><i style={{ background: "#237a61" }} /> Approved</span><span><i style={{ background: "#7c3aed" }} /> Completed</span></div>
            </section>
            <section className="panel chart-card">
              <div className="panel-heading"><div><h2>Status distribution</h2></div></div>
              <BarList items={dashboard.statusDistribution.map((entry) => ({ label: STATUS_LABELS[entry.status] ?? entry.status, value: entry.count }))} />
            </section>
            <section className="panel chart-card">
              <div className="panel-heading"><div><h2>Currency distribution</h2><p>Consolidated to USD.</p></div></div>
              <BarList items={dashboard.currency.map((entry) => ({ label: entry.code, value: Number(entry.totalUsd), sub: `${money(entry.totalUsd)} · ${entry.totalOriginal} ${entry.code}` }))} />
            </section>
            <section className="panel chart-card">
              <div className="panel-heading"><div><h2>Project expenditure</h2><p>Top projects by requested value.</p></div></div>
              <BarList items={dashboard.projects.map((entry) => ({ label: entry.projectName, value: Number(entry.totalRequestedUsd), sub: money(entry.totalRequestedUsd) }))} />
            </section>
          </div>

          <section className="panel report-panel">
            <div className="report-toolbar">
              <nav className="payment-master-tabs" aria-label="Reports">
                {REPORT_TABS.map((tab) => <button key={tab.key} className={reportTab === tab.key ? "active" : ""} onClick={() => selectReport(tab.key)}>{tab.label}</button>)}
              </nav>
              <div className="report-export">
                <span>Export:</span>
                {["csv", "xlsx", "pdf"].map((format) => <a key={format} className="button button-secondary button-small" href={exportHref(format)}><Download size={13} /> {format.toUpperCase()}</a>)}
              </div>
            </div>
            {reportLoading && <p>Loading report…</p>}
            {!reportLoading && report && (
              <div className="report-table-wrap">
                {reportTab === "overdue" && <p className="calendar-note">{String(report.extra.count ?? 0)} overdue invoices · {money(String(report.extra.totalUsd ?? "0"))}</p>}
                {reportTab === "upcoming" && <p className="calendar-note">{String(report.extra.count ?? 0)} upcoming payments · {money(String(report.extra.totalUsd ?? "0"))}</p>}
                <table className="summary-table report-table">
                  <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
                  <tbody>
                    {report.rows.map((row, index) => (
                      <tr key={(row.id as string) ?? index} className={row.delayed ? "row-delayed" : ""}>
                        {columns.map((column) => {
                          const value = row[column.key];
                          const content = column.money ? money(String(value ?? "0")) : value === null || value === undefined || value === "" ? "—" : String(value);
                          return <td key={column.key}>{column.key === "transactionId" && row.id ? <Link href={`/payment-requests/${row.id}`}>{content}</Link> : content}</td>;
                        })}
                      </tr>
                    ))}
                    {!report.rows.length && <tr><td colSpan={columns.length}>No records match the selected filters.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {dashboard.capped && <p className="calendar-note">Showing the first 5,000 records. Narrow the filters for a more specific view.</p>}
          <p className="calendar-note">Generated {new Date(dashboard.generatedAt).toLocaleString()} for {userName}.</p>
        </>
      )}
    </div>
  );
}
