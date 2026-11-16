"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, BadgeCheck, CircleX, Clock3, MessageSquareMore, RefreshCw } from "lucide-react";

type ApprovalItem = {
  id: string;
  transactionId: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  projectName: string;
  invoiceAmount: string | null;
  currencyCode: string | null;
  finalValueUsd: string | null;
  dueDate: string | null;
  submittedAt: string | null;
  requestorName: string;
  status: string;
  assignedAt: string | null;
  approverName: string | null;
  thresholdLabel: string | null;
  ageHours: number;
};
type DashboardData = {
  items: ApprovalItem[];
  stats: { pending: number; approved: number; rejected: number; clarification: number; pendingValueUsd: string; averageAgeHours: number; capped: boolean };
};

export function ApprovalDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/approvals");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load approval assignments.");
      setData(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load approval assignments.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const stats = data?.stats;

  return (
    <div className="payment-page">
      <div className="page-heading payment-heading">
        <div><span className="eyebrow">APPROVER WORKSPACE</span><h1>Approval dashboard</h1><p>Review and decide only on requests assigned to your account.</p></div>
        <button className="button button-secondary" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
      </div>
      <div className="workflow-stat-grid workflow-stat-grid-six">
        <div className="panel workflow-stat"><Clock3 size={19} /><span>Pending approvals</span><strong>{stats?.pending ?? "—"}</strong></div>
        <div className="panel workflow-stat"><BadgeCheck size={19} /><span>Approved</span><strong>{stats?.approved ?? "—"}</strong></div>
        <div className="panel workflow-stat"><CircleX size={19} /><span>Rejected</span><strong>{stats?.rejected ?? "—"}</strong></div>
        <div className="panel workflow-stat"><MessageSquareMore size={19} /><span>Awaiting clarification</span><strong>{stats?.clarification ?? "—"}</strong></div>
        <div className="panel workflow-stat"><span className="workflow-stat-symbol">$</span><span>Pending value (USD)</span><strong>{stats ? `$${Number(stats.pendingValueUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</strong></div>
        <div className="panel workflow-stat"><Clock3 size={19} /><span>Average approval aging</span><strong>{stats ? `${stats.averageAgeHours.toFixed(1)}h` : "—"}</strong></div>
      </div>
      {error && <div className="payment-alert" role="alert">{error}</div>}
      {stats?.capped && <div className="payment-info">Showing the most recent 200 records. Contact an administrator for a full historical export.</div>}
      <section className="panel payment-list-panel">
        <div className="panel-heading"><div><h2>Assigned requests</h2><p>{loading ? "Loading…" : `${data?.items.length ?? 0} assigned records`}</p></div></div>
        <div className="payment-table-wrap"><table className="payment-table"><thead><tr>
          <th>Transaction</th><th>Vendor / invoice</th><th>Project</th><th>Invoice value</th><th>USD equivalent</th><th>Due date</th><th>Requestor</th><th>Submitted</th><th>Status / age</th><th />
        </tr></thead><tbody>
          {data?.items.map((item) => <tr key={item.id}>
            <td><Link href={`/payment-requests/${item.id}`} className="payment-transaction">{item.transactionId}</Link></td>
            <td><strong>{item.vendorName || "—"}</strong><small>{item.invoiceNumber || "No invoice number"}</small></td>
            <td>{item.projectName}</td>
            <td>{item.invoiceAmount ? `${item.invoiceAmount} ${item.currencyCode ?? ""}` : "—"}</td>
            <td>{item.finalValueUsd ? `$${Number(item.finalValueUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</td>
            <td>{item.dueDate ?? "—"}</td><td>{item.requestorName}</td>
            <td>{item.submittedAt ? new Date(item.submittedAt).toLocaleDateString() : "—"}</td>
            <td><span className={`status-pill status-${item.status.toLowerCase().replaceAll("_", "-")}`}>{item.status.replaceAll("_", " ")}</span>{item.status === "PENDING_APPROVAL" && <small className="approval-aging">{item.ageHours.toFixed(1)}h · {item.thresholdLabel}</small>}</td>
            <td><Link className="button button-secondary" href={`/payment-requests/${item.id}`}>Open <ArrowUpRight size={14} /></Link></td>
          </tr>)}
          {!loading && !data?.items.length && <tr><td colSpan={10} className="payment-empty">There are no approval records assigned to you.</td></tr>}
        </tbody></table></div>
      </section>
    </div>
  );
}
