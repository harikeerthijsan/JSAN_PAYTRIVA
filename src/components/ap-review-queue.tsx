"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays, ClipboardCheck, RefreshCw } from "lucide-react";

type ReviewItem = {
  id: string;
  transactionId: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceAmount: string | null;
  currency: { code: string } | null;
  finalValueUsd: string | null;
  dueDate: string | null;
  submittedAt: string | null;
  status: string;
  requestor: { fullName: string };
  project: { name: string } | null;
};

export function APReviewQueue({ initialStatus = "" }: { initialStatus?: string }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [readyForPayment, setReadyForPayment] = useState<ReviewItem[]>([]);
  const [readyCount, setReadyCount] = useState(0);
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/ap/reviews${status ? `?status=${encodeURIComponent(status)}` : ""}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load AP review queue.");
      setItems(result.items);
      setReadyForPayment(result.readyForPayment);
      setReadyCount(result.readyCount);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load AP review queue.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="payment-page">
      <div className="page-heading payment-heading">
        <div><span className="eyebrow">ACCOUNTS PAYABLE</span><h1>AP review queue</h1><p>Validate submitted invoices before routing them to an approver.</p></div>
        <div className="ap-quick-links"><Link className="button button-secondary" href="/workspace/payables/payments">Payment queue</Link><Link className="button button-secondary" href="/workspace/payables/calendar"><CalendarDays size={15} /> Calendar</Link><button className="button button-secondary" onClick={() => void load()}><RefreshCw size={15} /> Refresh queue</button></div>
      </div>
      <label className="payment-field ap-review-filter"><span>Request status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All review statuses</option><option value="PENDING_REVIEW">Pending Review</option><option value="UNDER_REVIEW">Under Review</option><option value="RETURNED">Returned</option><option value="NEEDS_INFORMATION">Sent Back for Clarifications</option></select></label>
      <div className="workflow-stat-grid">
        <div className="panel workflow-stat"><ClipboardCheck size={19} /><span>Awaiting AP review</span><strong>{items.filter((item) => item.status === "PENDING_REVIEW").length}</strong></div>
        <div className="panel workflow-stat"><RefreshCw size={19} /><span>Currently in review</span><strong>{items.filter((item) => item.status === "UNDER_REVIEW").length}</strong></div>
      </div>
      {error && <div className="payment-alert" role="alert">{error}</div>}
      <section className="panel payment-list-panel">
        <div className="panel-heading"><div><h2>Submitted requests</h2><p>{loading ? "Loading…" : `${items.length} requests in the AP queue`}</p></div></div>
        <div className="payment-table-wrap"><table className="payment-table"><thead><tr>
          <th>Transaction</th><th>Vendor / invoice</th><th>Project</th><th>Invoice value</th><th>USD value</th><th>Due date</th><th>Requestor</th><th>Status</th><th />
        </tr></thead><tbody>
          {items.map((item) => <tr key={item.id}>
            <td><Link href={`/payment-requests/${item.id}`} className="payment-transaction">{item.transactionId}</Link></td>
            <td><strong>{item.vendorName || "—"}</strong><small>{item.invoiceNumber || "No invoice number"}</small></td>
            <td>{item.project?.name ?? "—"}</td>
            <td>{item.invoiceAmount ? `${item.invoiceAmount} ${item.currency?.code ?? ""}` : "—"}</td>
            <td>{item.finalValueUsd ? `$${Number(item.finalValueUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</td>
            <td>{item.dueDate ?? "—"}</td><td>{item.requestor.fullName}</td>
            <td><span className={`status-pill status-${item.status.toLowerCase().replaceAll("_", "-")}`}>{item.status.replaceAll("_", " ")}</span></td>
            <td><Link className="button button-secondary" href={`/payment-requests/${item.id}`}>Review <ArrowUpRight size={14} /></Link></td>
          </tr>)}
          {!loading && items.length === 0 && <tr><td colSpan={9} className="payment-empty">No submitted invoices are waiting for AP review.</td></tr>}
        </tbody></table></div>
      </section>
      <section className="panel payment-list-panel">
        <div className="panel-heading"><div><h2>Approved · ready for AP processing</h2><p>{readyCount} approved requests are eligible for scheduling and manual payment confirmation.</p></div><Link className="button button-secondary" href="/workspace/payables/payments">Open payment queue <ArrowUpRight size={14} /></Link></div>
        <div className="payment-table-wrap"><table className="payment-table"><thead><tr>
          <th>Transaction</th><th>Vendor / invoice</th><th>Project</th><th>Invoice value</th><th>USD value</th><th>Requestor</th><th />
        </tr></thead><tbody>
          {readyForPayment.map((item) => <tr key={item.id}>
            <td><Link href={`/payment-requests/${item.id}`} className="payment-transaction">{item.transactionId}</Link></td>
            <td><strong>{item.vendorName || "—"}</strong><small>{item.invoiceNumber || "No invoice number"}</small></td>
            <td>{item.project?.name ?? "—"}</td>
            <td>{item.invoiceAmount ? `${item.invoiceAmount} ${item.currency?.code ?? ""}` : "—"}</td>
            <td>{item.finalValueUsd ? `$${Number(item.finalValueUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</td>
            <td>{item.requestor.fullName}</td>
            <td><Link className="button button-secondary" href={`/payment-requests/${item.id}`}>Open <ArrowUpRight size={14} /></Link></td>
          </tr>)}
          {!loading && readyCount === 0 && <tr><td colSpan={7} className="payment-empty">No approved requests are waiting for AP processing.</td></tr>}
        </tbody></table></div>
      </section>
    </div>
  );
}
