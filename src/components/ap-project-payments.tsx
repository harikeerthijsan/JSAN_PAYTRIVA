"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCw } from "lucide-react";

type ProjectPayment = {
  projectId: string | null;
  projectName: string;
  totalRequestedUsd: string;
  totalApprovedUsd: string;
  totalPaidUsd: string;
  outstandingUsd: string;
  invoiceCount: number;
  pendingPayments: number;
  overduePayments: number;
};
type Project = { id: string; name: string };

export function APProjectPayments() {
  const [items, setItems] = useState<ProjectPayment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [vendor, setVendor] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const params = useMemo(() => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ projectId, vendor, status, from, to })) if (value) query.set(key, value);
    return query;
  }, [projectId, vendor, status, from, to]);
  const load = useCallback(async () => {
    setError("");
    try {
      const [response, masterResponse] = await Promise.all([fetch(`/api/ap/projects?${params}`), fetch("/api/payment-masters")]);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load project payment history.");
      setItems(result.items);
      if (masterResponse.ok) setProjects((await masterResponse.json()).projects);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load project payment history."); }
    finally { setLoading(false); }
  }, [params]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const money = (value: string) => `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="payment-page">
      <div className="page-heading payment-heading"><div><span className="eyebrow">ACCOUNTS PAYABLE</span><h1>Project payment history</h1><p>Requested, approved, paid, and outstanding invoice totals are shown in USD for comparison.</p></div><button className="button button-secondary" onClick={() => void load()}><RotateCw size={15} /> Refresh</button></div>
      <section className="panel ap-queue-filters project-payment-filters">
        <label className="payment-field"><span>Project</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">All projects</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
        <label className="payment-field"><span>Vendor</span><input value={vendor} onChange={(event) => setVendor(event.target.value)} /></label>
        <label className="payment-field"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All submitted statuses</option>{["PENDING_REVIEW", "UNDER_REVIEW", "PENDING_APPROVAL", "RETURNED", "NEEDS_INFORMATION", "APPROVED", "REJECTED", "PAID"].map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
        <label className="payment-field"><span>Invoice date from</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="payment-field"><span>Invoice date to</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </section>
      {error && <div className="payment-alert" role="alert">{error}</div>}
      <section className="panel payment-list-panel"><div className="panel-heading"><div><h2>Project summary</h2><p>{loading ? "Loading…" : `${items.length} projects`}</p></div></div>
        <div className="payment-table-wrap"><table className="payment-table project-payment-table"><thead><tr><th>Project</th><th>Total requested (USD)</th><th>Total approved (USD)</th><th>Total paid (USD)</th><th>Outstanding (USD)</th><th>Invoices</th><th>Pending payments</th><th>Overdue payments</th></tr></thead><tbody>
          {items.map((item) => <tr key={item.projectId ?? "unassigned"}><td><strong>{item.projectName}</strong></td><td>{money(item.totalRequestedUsd)}</td><td>{money(item.totalApprovedUsd)}</td><td>{money(item.totalPaidUsd)}</td><td>{money(item.outstandingUsd)}</td><td>{item.invoiceCount}</td><td>{item.pendingPayments}</td><td>{item.overduePayments}</td></tr>)}
          {!loading && !items.length && <tr><td className="payment-empty" colSpan={8}>No project payment history matches these filters.</td></tr>}
        </tbody></table></div>
      </section>
    </div>
  );
}
