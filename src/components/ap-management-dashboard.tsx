"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { CalendarDays, CircleDollarSign, ClipboardCheck, Clock3, FileClock, FileWarning, ListChecks, RefreshCw } from "lucide-react";

type DashboardData = {
  metrics: {
    pendingReview: number;
    approvedWaiting: number;
    dueThisWeek: number;
    overdue: number;
    returned: number;
    clarification: number;
    totalPaidUsd: string;
  };
  filters: {
    currencies: { code: string; name: string }[];
    projects: { id: string; name: string }[];
    approvers: { id: string; fullName: string }[];
  };
};
type FilterValues = {
  status: string; vendor: string; projectId: string; invoiceFrom: string;
  invoiceTo: string; dueFrom: string; dueTo: string; currency: string;
  approverId: string; transactionId: string;
};
const emptyFilters: FilterValues = {
  status: "", vendor: "", projectId: "", invoiceFrom: "", invoiceTo: "",
  dueFrom: "", dueTo: "", currency: "", approverId: "", transactionId: "",
};

export function APManagementDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    const params = new URLSearchParams(Object.entries(applied).filter(([, value]) => value));
    try {
      const response = await fetch(`/api/ap/management?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load AP management dashboard.");
      setData(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load AP management dashboard.");
    } finally {
      setLoading(false);
    }
  }, [applied]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApplied(filters);
  }

  const metrics = data?.metrics;
  const cards = [
    { label: "Total pending review", value: metrics?.pendingReview ?? "—", icon: ClipboardCheck, href: "/workspace/payables/review?status=PENDING_REVIEW" },
    { label: "Approved · waiting for payment", value: metrics?.approvedWaiting ?? "—", icon: ListChecks, href: "/workspace/payables/payments" },
    { label: "Payments due this week", value: metrics?.dueThisWeek ?? "—", icon: CalendarDays, href: "/workspace/payables/calendar?view=week" },
    { label: "Overdue invoices", value: metrics?.overdue ?? "—", icon: Clock3, href: "/workspace/payables/calendar?view=overdue" },
    { label: "Returned invoices", value: metrics?.returned ?? "—", icon: FileWarning, href: "/workspace/payables/review?status=RETURNED" },
    { label: "Sent back for clarification", value: metrics?.clarification ?? "—", icon: FileClock, href: "/workspace/payables/review?status=NEEDS_INFORMATION" },
    { label: "Total paid (USD)", value: metrics ? `$${Number(metrics.totalPaidUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—", icon: CircleDollarSign, href: "/workspace/payables/calendar?view=completed" },
  ];

  return (
    <div className="payment-page">
      <div className="page-heading payment-heading"><div><span className="eyebrow">ACCOUNTS PAYABLE</span><h1>AP management</h1><p>Review approved invoices, plan payment dates, and record manually completed payments.</p></div>
        <button className="button button-secondary" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
      </div>
      <form className="panel ap-filter-panel" onSubmit={applyFilters}>
        <label className="payment-field"><span>Payment status</span><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="">All statuses</option>
          {["PENDING_REVIEW", "UNDER_REVIEW", "RETURNED", "PENDING_APPROVAL", "APPROVED", "NEEDS_INFORMATION", "REJECTED", "PAID"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
        </select></label>
        <label className="payment-field"><span>Vendor</span><input value={filters.vendor} onChange={(event) => setFilters({ ...filters, vendor: event.target.value })} /></label>
        <label className="payment-field"><span>Project</span><select value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}><option value="">All projects</option>{data?.filters.projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label className="payment-field"><span>Currency</span><select value={filters.currency} onChange={(event) => setFilters({ ...filters, currency: event.target.value })}><option value="">All currencies</option>{data?.filters.currencies.map((item) => <option value={item.code} key={item.code}>{item.code} · {item.name}</option>)}</select></label>
        <label className="payment-field"><span>Approver</span><select value={filters.approverId} onChange={(event) => setFilters({ ...filters, approverId: event.target.value })}><option value="">All approvers</option>{data?.filters.approvers.map((item) => <option value={item.id} key={item.id}>{item.fullName}</option>)}</select></label>
        <label className="payment-field"><span>Transaction ID</span><input value={filters.transactionId} onChange={(event) => setFilters({ ...filters, transactionId: event.target.value })} /></label>
        <label className="payment-field"><span>Invoice date from</span><input type="date" value={filters.invoiceFrom} onChange={(event) => setFilters({ ...filters, invoiceFrom: event.target.value })} /></label>
        <label className="payment-field"><span>Invoice date to</span><input type="date" value={filters.invoiceTo} onChange={(event) => setFilters({ ...filters, invoiceTo: event.target.value })} /></label>
        <label className="payment-field"><span>Due date from</span><input type="date" value={filters.dueFrom} onChange={(event) => setFilters({ ...filters, dueFrom: event.target.value })} /></label>
        <label className="payment-field"><span>Due date to</span><input type="date" value={filters.dueTo} onChange={(event) => setFilters({ ...filters, dueTo: event.target.value })} /></label>
        <div className="ap-filter-actions"><button className="button button-primary" type="submit">Apply filters</button><button className="button button-secondary" type="button" onClick={() => { setFilters(emptyFilters); setApplied(emptyFilters); }}>Clear</button></div>
      </form>
      {error && <div className="payment-alert" role="alert">{error}</div>}
      <div className="workflow-stat-grid ap-metric-grid">{cards.map(({ label, value, icon: Icon, href }) => <Link className="panel workflow-stat ap-metric-card" href={href} key={label}>
        <Icon size={19} /><span>{label}</span><strong>{loading ? "…" : value}</strong>
      </Link>)}</div>
      <div className="ap-quick-links">
        <Link className="button button-primary" href="/workspace/payables/review">AP review queue</Link>
        <Link className="button button-secondary" href="/workspace/payables/payments">Payment processing queue</Link>
        <Link className="button button-secondary" href="/workspace/payables/calendar">Payment calendar</Link>
        <Link className="button button-secondary" href="/workspace/payables/projects">Project payment history</Link>
      </div>
    </div>
  );
}
