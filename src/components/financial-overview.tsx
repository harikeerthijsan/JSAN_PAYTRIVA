"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  CalendarDays,
  ChartNoAxesCombined,
  CircleAlert,
  ClipboardList,
  Clock3,
  FileCheck2,
  Layers3,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { CurrencySwitcher } from "@/components/currency-switcher";
import type { LiveDashboardRates } from "@/lib/live-dashboard-rates";
import { dashboardMoney } from "@/lib/dashboard-currency";

type KpiValue = { usd: string; count: number };
type ManagementData = {
  kpis: {
    totalOpenAp: KpiValue;
    dueThisWeek: KpiValue;
    overdue: KpiValue;
    totalPaid: KpiValue;
    pendingApprovals: KpiValue;
    approvedWaiting: KpiValue;
    totalRequests: KpiValue;
  };
  statusDistribution: { status: string; count: number }[];
  trends: { month: string; requests: number; approvedCount: number; completedCount: number }[];
  projects: { projectName: string; totalRequestedUsd: string }[];
};
type ApData = {
  metrics: {
    pendingReview: number;
    approvedWaiting: number;
    dueThisWeek: number;
    overdue: number;
    returned: number;
    clarification: number;
    totalPaidUsd: string;
  };
};
type ApprovalData = {
  items: {
    id: string;
    transactionId: string;
    vendorName: string | null;
    invoiceNumber: string | null;
    projectName: string;
    finalValueUsd: string | null;
    status: string;
    submittedAt: string | null;
  }[];
  stats: { pending: number; approved: number; rejected: number; clarification: number; averageAgeHours: number };
};
type RequestData = {
  items: {
    id: string;
    transactionId: string;
    vendorName: string | null;
    invoiceNumber: string | null;
    invoiceAmount: string | null;
    invoiceAmountUsd: string | null;
    currency: { code: string } | null;
    project: { name: string } | null;
    status: string;
    createdAt: string;
  }[];
  total: number;
  statusCounts: Record<string, number>;
};
type CalendarData = {
  cycles: { date: string; count: number; totalUsd: string }[];
  nextWednesday: string;
};
type RecentItem = {
  id: string;
  href: string;
  transactionId: string;
  vendor: string;
  invoice: string;
  project: string;
  amount: string;
  currency: string;
  status: string;
  date: string;
};
type OverviewData = {
  management?: ManagementData;
  ap?: ApData;
  approvals?: ApprovalData;
  requests?: RequestData;
  calendar?: CalendarData;
  recent: RecentItem[];
};
type Card = { label: string; value: string; note: string; icon: typeof ClipboardList; tone: string; href: string };

const STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: "Pending AP review",
  UNDER_REVIEW: "Under review",
  PENDING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  PAID: "Paid",
  RETURNED: "Returned",
  NEEDS_INFORMATION: "Clarification",
  REJECTED: "Rejected",
  DRAFT: "Draft",
  CANCELLED: "Cancelled",
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ").toLowerCase();
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Unable to load your dashboard.");
  return result as T;
}

function countStatuses(counts: Record<string, number>) {
  return Object.entries(counts)
    .map(([status, count]) => ({ status, count }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function FinancialOverview({
  permissions,
  fullName,
  exchangeRates,
}: {
  permissions: string[];
  fullName: string;
  exchangeRates: LiveDashboardRates;
}) {
  const [displayCurrency, setDisplayCurrency] = useState("USD");
  const [liveRates, setLiveRates] = useState(exchangeRates);
  const [rateError, setRateError] = useState(false);
  const currencyOptions = liveRates.currencies;
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const latest = await getJson<LiveDashboardRates>("/api/dashboard/exchange-rates");
        if (active) { setLiveRates(latest); setRateError(false); }
      } catch {
        // Keep the last dated rates visible and clearly mark the failed refresh.
        if (active) setRateError(true);
      }
    };
    const timer = window.setInterval(() => { void refresh(); }, 3600000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, []);
  const selectedCurrency = currencyOptions.find((item) => item.code === displayCurrency) ?? currencyOptions[0];
  const money = useCallback((value: string | number | null | undefined) => dashboardMoney(value, selectedCurrency), [selectedCurrency]);
  const [data, setData] = useState<OverviewData>({ recent: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canManageReports = permissions.includes("reports:access");
  const canAccessAp = permissions.includes("ap:access");
  const canApprove = permissions.includes("approvals:access");
  const canReadRequests = permissions.includes("payments:read_own") || permissions.includes("payments:read_all");
  const canViewCalendar = canReadRequests || canApprove;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const from = new Date();
      const to = new Date(from);
      to.setUTCDate(to.getUTCDate() + 7);
      const fromDay = from.toISOString().slice(0, 10);
      const toDay = to.toISOString().slice(0, 10);
      const [management, ap, approvals, requests, apQueue, calendar] = await Promise.all([
        canManageReports ? getJson<ManagementData>("/api/management/dashboard") : Promise.resolve(undefined),
        canAccessAp && !canManageReports ? getJson<ApData>("/api/ap/management") : Promise.resolve(undefined),
        canApprove && !canManageReports && !canAccessAp ? getJson<ApprovalData>("/api/approvals") : Promise.resolve(undefined),
        canReadRequests ? getJson<RequestData>("/api/payment-requests?page=1&pageSize=5&sort=createdAt&direction=desc") : Promise.resolve(undefined),
        canAccessAp && !canReadRequests ? getJson<{ items: { id: string; transactionId: string; vendorName: string | null; invoiceNumber: string | null; project: { name: string } | null; finalValueUsd: string | null; currency: { code: string } | null; statusLabel: string; dueDate: string | null }[] }>("/api/ap/payments?page=1&pageSize=5&sort=dueDate") : Promise.resolve(undefined),
        canViewCalendar ? getJson<CalendarData>(`/api/payment-calendar/upcoming?from=${fromDay}&to=${toDay}`) : Promise.resolve(undefined),
      ]);

      const recent: RecentItem[] = requests?.items.map((item) => ({
        id: item.id,
        href: `/payment-requests/${item.id}`,
        transactionId: item.transactionId,
        vendor: item.vendorName || "Vendor not set",
        invoice: item.invoiceNumber || "—",
        project: item.project?.name ?? "—",
        amount: item.invoiceAmountUsd ?? (item.currency?.code === "USD" ? item.invoiceAmount : null) ?? "",
        currency: "USD",
        status: item.status,
        date: item.createdAt,
      })) ?? approvals?.items.slice(0, 5).map((item) => ({
        id: item.id,
        href: `/payment-requests/${item.id}`,
        transactionId: item.transactionId,
        vendor: item.vendorName || "Vendor not set",
        invoice: item.invoiceNumber || "—",
        project: item.projectName,
        amount: item.finalValueUsd ?? "",
        currency: "USD",
        status: item.status,
        date: item.submittedAt ?? "",
      })) ?? apQueue?.items.slice(0, 5).map((item) => ({
        id: item.id,
        href: `/workspace/payables/payments/${item.id}`,
        transactionId: item.transactionId,
        vendor: item.vendorName || "Vendor not set",
        invoice: item.invoiceNumber || "—",
        project: item.project?.name ?? "—",
        amount: item.finalValueUsd ?? "",
        currency: "USD",
        status: "APPROVED",
        date: item.dueDate ?? "",
      })) ?? [];

      setData({ management, ap, approvals, requests, calendar, recent });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, [canAccessAp, canApprove, canManageReports, canReadRequests, canViewCalendar]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const cards = useMemo<Card[]>(() => {
    const management = data.management;
    if (management) return [
      { label: "Total requests", value: String(management.kpis.totalRequests.count), note: "Across your organization", icon: Layers3, tone: "blue", href: "/payment-requests" },
      { label: "Pending AP review", value: String(management.kpis.totalOpenAp.count), note: money(management.kpis.totalOpenAp.usd), icon: Clock3, tone: "amber", href: canAccessAp ? "/workspace/payables/review" : "/workspace/management" },
      { label: "Awaiting approvals", value: String(management.kpis.pendingApprovals.count), note: money(management.kpis.pendingApprovals.usd), icon: UserRound, tone: "violet", href: canApprove ? "/workspace/approvals" : "/workspace/management" },
      { label: "Due this week", value: String(management.kpis.dueThisWeek.count), note: money(management.kpis.dueThisWeek.usd), icon: CalendarDays, tone: "cyan", href: canAccessAp ? "/workspace/payables/calendar?view=week" : "/workspace/management" },
      { label: "Overdue payments", value: String(management.kpis.overdue.count), note: money(management.kpis.overdue.usd), icon: CircleAlert, tone: "red", href: canAccessAp ? "/workspace/payables/calendar?view=overdue" : "/workspace/management" },
    ];
    if (data.ap) return [
      { label: "Pending AP review", value: String(data.ap.metrics.pendingReview), note: "Needs your team’s review", icon: ClipboardList, tone: "blue", href: "/workspace/payables/review?status=PENDING_REVIEW" },
      { label: "Waiting for payment", value: String(data.ap.metrics.approvedWaiting), note: "Approved invoices", icon: Banknote, tone: "violet", href: "/workspace/payables/payments" },
      { label: "Due this week", value: String(data.ap.metrics.dueThisWeek), note: "Scheduled or due soon", icon: CalendarDays, tone: "cyan", href: "/workspace/payables/calendar?view=week" },
      { label: "Overdue invoices", value: String(data.ap.metrics.overdue), note: "Require attention", icon: CircleAlert, tone: "red", href: "/workspace/payables/calendar?view=overdue" },
      { label: "Total paid", value: money(data.ap.metrics.totalPaidUsd), note: "Confirmed payments \u00b7 " + selectedCurrency.code, icon: BadgeCheck, tone: "green", href: "/workspace/payables/calendar?view=completed" },
    ];
    if (data.approvals) return [
      { label: "Awaiting your approval", value: String(data.approvals.stats.pending), note: "Assigned requests awaiting action", icon: Clock3, tone: "amber", href: "/workspace/approvals" },
      { label: "Approved", value: String(data.approvals.stats.approved), note: "Assigned requests", icon: BadgeCheck, tone: "green", href: "/workspace/approvals" },
      { label: "Needs clarification", value: String(data.approvals.stats.clarification), note: "Requests returned for information", icon: CircleAlert, tone: "cyan", href: "/workspace/approvals" },
      { label: "Rejected", value: String(data.approvals.stats.rejected), note: "Assigned requests", icon: FileCheck2, tone: "red", href: "/workspace/approvals" },
      { label: "Average pending age", value: `${Math.round(data.approvals.stats.averageAgeHours)}h`, note: "For pending assignments", icon: Clock3, tone: "violet", href: "/workspace/approvals" },
    ];
    const counts = data.requests?.statusCounts ?? {};
    return [
      { label: "Total requests", value: String(data.requests?.total ?? 0), note: "Your submitted requests", icon: Layers3, tone: "blue", href: "/payment-requests" },
      { label: "In review", value: String((counts.PENDING_REVIEW ?? 0) + (counts.UNDER_REVIEW ?? 0)), note: "With Accounts Payable", icon: Clock3, tone: "amber", href: "/payment-requests" },
      { label: "Awaiting approval", value: String(counts.PENDING_APPROVAL ?? 0), note: "Assigned to an approver", icon: UserRound, tone: "violet", href: "/payment-requests" },
      { label: "Approved", value: String(counts.APPROVED ?? 0), note: "Waiting for payment", icon: BadgeCheck, tone: "cyan", href: "/payment-requests" },
      { label: "Paid", value: String(counts.PAID ?? 0), note: "Payment completed", icon: Banknote, tone: "green", href: "/payment-requests" },
    ];
  }, [canAccessAp, canApprove, data, money, selectedCurrency.code]);

  const trend = data.management?.trends ?? [];
  const trendMax = Math.max(1, ...trend.flatMap((item) => [item.requests, item.approvedCount, item.completedCount]));
  const statuses = data.management?.statusDistribution ?? (data.approvals
    ? [
      { status: "PENDING_APPROVAL", count: data.approvals.stats.pending },
      { status: "APPROVED", count: data.approvals.stats.approved },
      { status: "NEEDS_INFORMATION", count: data.approvals.stats.clarification },
      { status: "REJECTED", count: data.approvals.stats.rejected },
    ]
    : data.ap ? [
      { status: "PENDING_REVIEW", count: data.ap.metrics.pendingReview },
      { status: "APPROVED", count: data.ap.metrics.approvedWaiting },
      { status: "RETURNED", count: data.ap.metrics.returned },
      { status: "NEEDS_INFORMATION", count: data.ap.metrics.clarification },
    ]
    : data.requests ? countStatuses(data.requests.statusCounts) : []);
  const statusTotal = statuses.reduce((sum, item) => sum + item.count, 0);
  const statusStops = statuses.reduce<{ stops: string[]; total: number }>((acc, item, index) => {
    const colors = ["#1478f2", "#10b981", "#f5a623", "#8b5cf6", "#f04452", "#22b8cf", "#a4b2c4"];
    const next = acc.total + (statusTotal ? item.count / statusTotal * 100 : 0);
    acc.stops.push(`${colors[index % colors.length]} ${acc.total.toFixed(2)}% ${next.toFixed(2)}%`);
    acc.total = next;
    return acc;
  }, { stops: [], total: 0 });
  const distributionBackground = statusStops.stops.length
    ? `conic-gradient(${statusStops.stops.join(", ")})`
    : "conic-gradient(#e7edf5 0 100%)";
  const displayName = fullName.trim().split(/\s+/)[0] || "there";
  const paymentCycle = data.calendar?.cycles[0];
  const trendPoints = trend.slice(-8);
  const trendSeries = [
    { key: "requests", className: "trend-line-requests", value: (item: ManagementData["trends"][number]) => item.requests },
    { key: "approved", className: "trend-line-approved", value: (item: ManagementData["trends"][number]) => item.approvedCount },
    { key: "paid", className: "trend-line-paid", value: (item: ManagementData["trends"][number]) => item.completedCount },
  ];
  const trendPath = (value: (item: ManagementData["trends"][number]) => number) => trendPoints
    .map((item, index) => {
      const x = trendPoints.length < 2 ? 300 : 24 + index * (552 / (trendPoints.length - 1));
      const y = 172 - value(item) / trendMax * 148;
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  return (
    <div className="financial-overview">
      <header className="overview-greeting">
        <div><h1>Good to see you, {displayName}</h1><p>Here’s your financial workspace at a glance.</p></div>
        <div className="overview-greeting-actions">
          <CurrencySwitcher currencies={currencyOptions} value={selectedCurrency.code} onChange={setDisplayCurrency} />
          {permissions.includes("payments:create") && <Link href="/payment-requests/new" className="overview-create-link"><ClipboardList size={16} /> New request</Link>}
        </div>
      </header>
      <p className="overview-currency-note" aria-live="polite">
        Amounts displayed in {selectedCurrency.code}. Daily reference rates from <a href="https://frankfurter.dev/" target="_blank" rel="noreferrer">Frankfurter</a>; checked hourly.
        {selectedCurrency.rateDate && " Rate date: " + selectedCurrency.rateDate + "."}
        {selectedCurrency.code === "USD" && currencyOptions.filter((item) => item.rateDate).map((item) => " " + item.code + ": " + item.rateDate + ".")}
        {liveRates.unavailable.length > 0 && " " + liveRates.unavailable.join(" / ") + " rates temporarily unavailable. USD remains available."}
        {rateError && " Unable to refresh rates; showing the last retrieved rates with their publication date. Reload to retry."}
        {displayCurrency !== selectedCurrency.code && " Selected currency is unavailable; amounts are now shown in USD."}
      </p>
      <section className="overview-lifecycle-banner" aria-label="PAYTRIVA payment lifecycle">
        <Image
          alt="Payment lifecycle: submit a request, AP reviews the invoice, an approver authorizes or rejects it, and approved payments are processed weekly."
          className="overview-lifecycle-image"
          height={325}
          priority
          src="/payment-lifecycle.png"
          width={2172}
        />
      </section>

      {error && <div className="overview-error" role="alert">{error}<button onClick={() => void load()}><RefreshCw size={14} /> Retry</button></div>}

      <section className="overview-kpis" aria-label="Financial overview">
        {cards.map(({ label, value, note, icon: Icon, tone, href }) => (
          <Link className="overview-kpi" href={href} key={label}>
            <span className={`overview-kpi-icon tone-${tone}`}><Icon size={20} /></span>
            <span className="overview-kpi-body"><small>{label}</small><strong>{loading ? "…" : value}</strong><em>{note}</em></span>
            <ArrowUpRight size={15} className="overview-kpi-arrow" />
          </Link>
        ))}
      </section>

      <section className="overview-panels">
        <article className="overview-panel overview-trend-panel">
          <div className="overview-panel-heading">
            <div><span className="overview-panel-icon"><ChartNoAxesCombined size={17} /></span><div><h2>Payment activity</h2><p>{canManageReports ? "Monthly request volume" : "Requests by current status"}</p></div></div>
            {canManageReports && <Link href="/workspace/management">Full report <ArrowRight size={14} /></Link>}
          </div>
          {canManageReports && trend.length ? (
            <div className="overview-chart" role="img" aria-label="Monthly request volume trend">
              <div className="overview-chart-y"><span>{trendMax}</span><span>{Math.round(trendMax / 2)}</span><span>0</span></div>
              <div className="overview-chart-plot">
                <div className="overview-chart-grid"><i /><i /><i /></div>
                <svg className="overview-trend-svg" viewBox="0 0 600 190" preserveAspectRatio="none" aria-hidden="true">
                  {trendSeries.map((series) => <path key={series.key} className={series.className} d={trendPath(series.value)} />)}
                  {trendPoints.map((item, index) => {
                    const x = trendPoints.length < 2 ? 300 : 24 + index * (552 / (trendPoints.length - 1));
                    const y = 172 - item.requests / trendMax * 148;
                    return <circle key={item.month} cx={x} cy={y} r="3.5" />;
                  })}
                </svg>
                <div className="overview-chart-months">{trendPoints.map((item) => <small key={item.month}>{new Date(`${item.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</small>)}</div>
              </div>
            </div>
          ) : (
            <div className="overview-status-content">
              <div className="overview-status-ring" style={{ background: distributionBackground }}><div><strong>{statusTotal}</strong><span>Requests</span></div></div>
              <div className="overview-status-list">
                {statuses.slice(0, 6).map((item, index) => (
                  <div key={item.status}><i className={`status-color status-color-${index}`} /><span>{statusLabel(item.status)}</span><strong>{item.count}</strong></div>
                ))}
                {!statuses.length && <p>{loading ? "Loading activity…" : "No request activity yet."}</p>}
              </div>
            </div>
          )}
          {canManageReports && (
            <div className="overview-chart-legend"><span><i className="legend-blue" /> Requests</span><span><i className="legend-green" /> Approved</span><span><i className="legend-cyan" /> Paid</span></div>
          )}
        </article>

        {canManageReports && (
          <article className="overview-panel overview-status-panel">
            <div className="overview-panel-heading">
              <div><span className="overview-panel-icon"><ChartNoAxesCombined size={17} /></span><div><h2>Payment status</h2><p>Requests by current status</p></div></div>
              <Link href="/workspace/management">Details <ArrowRight size={14} /></Link>
            </div>
            <div className="overview-status-content">
              <div className="overview-status-ring" style={{ background: distributionBackground }}><div><strong>{statusTotal}</strong><span>Requests</span></div></div>
              <div className="overview-status-list">
                {statuses.slice(0, 6).map((item, index) => (
                  <div key={item.status}><i className={`status-color status-color-${index}`} /><span>{statusLabel(item.status)}</span><strong>{item.count}</strong></div>
                ))}
                {!statuses.length && <p>{loading ? "Loading activity…" : "No request activity yet."}</p>}
              </div>
            </div>
          </article>
        )}

        <article className="overview-panel overview-action-panel">
          <div className="overview-panel-heading">
            <div><span className="overview-panel-icon"><CalendarDays size={17} /></span><div><h2>This week’s payment run</h2><p>Scheduled payments {selectedCurrency.code}</p></div></div>
          </div>
          <div className="overview-run-summary">
            <span className="overview-run-date"><CalendarDays size={15} />{paymentCycle ? new Date(`${paymentCycle.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : data.calendar ? new Date(`${data.calendar.nextWednesday}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—"}</span>
            <strong>{paymentCycle ? money(paymentCycle.totalUsd) : loading ? "…" : money(0)}</strong>
            <small>{paymentCycle ? `${paymentCycle.count} scheduled ${paymentCycle.count === 1 ? "payment" : "payments"}` : "No payments scheduled for this run"}</small>
          </div>
          <div className="overview-run-links">
            {canAccessAp && <Link href="/workspace/payables/review">AP review <ArrowRight size={14} /></Link>}
            {canAccessAp && <Link href="/workspace/payables/payments">Payment queue <ArrowRight size={14} /></Link>}
            {canApprove && <Link href="/workspace/approvals">Approvals <ArrowRight size={14} /></Link>}
            {permissions.includes("payments:create") && <Link href="/payment-requests/new">Create request <ArrowRight size={14} /></Link>}
            {permissions.includes("reports:access") && <Link href="/workspace/management">Financial reports <ArrowRight size={14} /></Link>}
          </div>
        </article>

        {!canManageReports && (
          <article className="overview-panel overview-shortcuts-panel">
            <div className="overview-panel-heading">
              <div><span className="overview-panel-icon"><ArrowRight size={17} /></span><div><h2>Work to move forward</h2><p>Shortcuts matched to your access</p></div></div>
            </div>
            <div className="overview-run-links overview-shortcut-links">
              {canAccessAp && <Link href="/workspace/payables/review">AP review queue <ArrowRight size={14} /></Link>}
              {canAccessAp && <Link href="/workspace/payables/payments">Payment processing <ArrowRight size={14} /></Link>}
              {canApprove && <Link href="/workspace/approvals">Approval workspace <ArrowRight size={14} /></Link>}
              {permissions.includes("payments:create") && <Link href="/payment-requests/new">Create a request <ArrowRight size={14} /></Link>}
              {canReadRequests && <Link href="/payment-requests">My requests <ArrowRight size={14} /></Link>}
              <Link href="/profile">Account profile <ArrowRight size={14} /></Link>
            </div>
          </article>
        )}
      </section>

      <section className="overview-bottom">
        <article className="overview-panel overview-recent-panel">
          <div className="overview-panel-heading">
            <div><span className="overview-panel-icon"><FileCheck2 size={17} /></span><div><h2>{canApprove && !canReadRequests ? "Assigned requests" : canAccessAp && !canReadRequests ? "Payment queue" : "Recent payment requests"}</h2><p>{loading ? "Loading latest activity…" : `${data.recent.length} latest records`}</p></div></div>
            {canReadRequests && <Link href="/payment-requests">View all <ArrowRight size={14} /></Link>}
          </div>
          <div className="overview-table-wrap">
            <table className="overview-table">
              <thead><tr><th>Transaction</th><th>Vendor / invoice</th><th>Project</th><th>Amount ({selectedCurrency.code})</th><th>Status</th></tr></thead>
              <tbody>
                {data.recent.map((item) => (
                  <tr key={item.id}>
                    <td><Link href={item.href}>{item.transactionId}</Link></td>
                    <td><strong>{item.vendor}</strong><small>Invoice {item.invoice}</small></td>
                    <td>{item.project}</td>
                    <td>{item.amount ? money(item.amount) : "—"}</td>
                    <td><span className={`overview-status-pill status-pill-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span></td>
                  </tr>
                ))}
                {!loading && !data.recent.length && <tr><td className="overview-empty" colSpan={5}>Your accessible requests will appear here.</td></tr>}
              </tbody>
            </table>
          </div>
        </article>

        <article className="overview-panel overview-project-panel">
          <div className="overview-panel-heading">
            <div><span className="overview-panel-icon"><Layers3 size={17} /></span><div><h2>Project activity</h2><p>{canManageReports ? "Requested amount " + selectedCurrency.code : "Your account security"}</p></div></div>
            {canManageReports && <Link href="/workspace/management">View report <ArrowRight size={14} /></Link>}
          </div>
          {data.management?.projects.length ? (
            <ul className="overview-project-list">
              {data.management.projects.slice(0, 5).map((project) => {
                const max = Math.max(1, ...data.management!.projects.map((item) => Number(item.totalRequestedUsd)));
                const width = Math.min(100, Number(project.totalRequestedUsd) / max * 100);
                return <li key={project.projectName}><span>{project.projectName}</span><i><b style={{ width: `${width}%` }} /></i><strong>{money(project.totalRequestedUsd)}</strong></li>;
              })}
            </ul>
          ) : (
            <div className="overview-security-note"><span><ShieldCheck size={19} /></span><div><strong>Protected workspace</strong><p>Your views and actions are governed by your assigned role and permissions.</p><small>Access follows your assigned permissions</small></div></div>
          )}
        </article>
      </section>

      <footer className="overview-footer"><span>PAYTRIVA <i /> JSAN CONSULTING</span><span>Financial workflows, clearly in control.</span></footer>
    </div>
  );
}
