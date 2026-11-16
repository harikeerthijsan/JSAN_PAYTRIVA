"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownUp, ArrowRight, Plus, Search } from "lucide-react";

type Item = {
  id: string;
  transactionId: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceAmount: string | null;
  invoiceAmountUsd: string | null;
  currency: { code: string; symbol: string; decimalPlaces: number } | null;
  project: { id: string; name: string } | null;
  dueDate: string | null;
  submittedAt: string | null;
  createdAt: string;
  requestor: { fullName: string };
  statusLabel: string;
};

type Options = { projects: { id: string; name: string }[] };

export function PaymentRequestList({ canCreate, canReadAll, initialSearch = "" }: { canCreate: boolean; canReadAll: boolean; initialSearch?: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [options, setOptions] = useState<Options>({ projects: [] });
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState("");
  const [projectId, setProjectId] = useState("");
  const [vendor, setVendor] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [direction, setDirection] = useState("desc");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: "20", sort, direction });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (projectId) params.set("projectId", projectId);
    if (vendor) params.set("vendor", vendor);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    try {
      const [response, masterResponse] = await Promise.all([
        fetch(`/api/payment-requests?${params}`),
        fetch("/api/payment-masters"),
      ]);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to load payment requests.");
      setItems(data.items);
      setPages(Math.max(1, data.pages));
      if (masterResponse.ok) {
        const masterData = await masterResponse.json();
        setOptions({ projects: masterData.projects });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load payment requests.");
    } finally {
      setLoading(false);
    }
  }, [page, search, status, projectId, vendor, dateFrom, dateTo, sort, direction]);
  function displayAmount(value: string | null, currency: string | null, decimals = 2) {
    if (!value) return "—";
    const [whole, fraction = ""] = value.split(".");
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(fraction + "0".repeat(decimals)).slice(0, decimals)}${currency ? ` ${currency}` : ""}`;
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="payment-page">
      <div className="page-heading payment-heading">
        <div><span className="eyebrow">{canReadAll ? "PAYABLES" : "YOUR FINANCE"}</span><h1>Payment requests</h1><p>Create requests, manage drafts, and track submitted invoices.</p></div>
        {canCreate && <Link className="button button-primary" href="/payment-requests/new"><Plus size={16} /> New request</Link>}
      </div>
      <section className="payment-filters panel">
        <label className="payment-search"><Search size={16} /><input placeholder="Search ID, vendor, invoice or project" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <label><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{["DRAFT", "PENDING_REVIEW", "UNDER_REVIEW", "PENDING_APPROVAL", "NEEDS_INFORMATION", "APPROVED", "REJECTED", "PAID", "CANCELLED"].map((item) => <option value={item} key={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
        <label><span>Project</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); setPage(1); }}><option value="">All projects</option>{options.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label><span>Vendor</span><input value={vendor} onChange={(event) => { setVendor(event.target.value); setPage(1); }} placeholder="Filter vendor" /></label>
        <label><span>From</span><input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} /></label>
        <label><span>To</span><input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} /></label>
        <label><span>Sort by</span><select value={`${sort}:${direction}`} onChange={(event) => { const [nextSort, nextDirection] = event.target.value.split(":"); setSort(nextSort); setDirection(nextDirection); }}><option value="createdAt:desc">Newest first</option><option value="createdAt:asc">Oldest first</option><option value="dueDate:asc">Due date</option><option value="vendorName:asc">Vendor A–Z</option><option value="status:asc">Status</option></select></label>
      </section>
      {error && <div className="payment-alert" role="alert">{error}</div>}
      <section className="panel payment-table-panel">
        <div className="table-heading"><div><h2>Requests</h2><p>{loading ? "Loading…" : `${items.length} shown · page ${page} of ${pages}`}</p></div><button className="icon-button" aria-label="Refresh requests" onClick={() => void load()}><ArrowDownUp size={17} /></button></div>
        <div className="payment-table-wrap">
          <table className="payment-table"><thead><tr><th>Transaction ID</th><th>Vendor / Invoice</th><th>Project</th><th>Invoice amount</th><th>USD equivalent</th><th>Due date</th><th>Submitted</th><th>Requestor</th><th>Status</th><th /></tr></thead>
            <tbody>{items.map((item) => <tr key={item.id}>
              <td><Link className="transaction-link" href={`/payment-requests/${item.id}`}>{item.transactionId}</Link></td>
              <td><strong>{item.vendorName || "—"}</strong><small>Invoice {item.invoiceNumber || "—"}</small></td>
              <td>{item.project?.name ?? "—"}</td>
              <td>{item.invoiceAmount && item.currency ? `${item.currency.symbol} ${displayAmount(item.invoiceAmount, item.currency.code, item.currency.decimalPlaces)}` : "—"}</td>
              <td>{item.invoiceAmountUsd ? displayAmount(item.invoiceAmountUsd, "USD") : "—"}</td>
              <td>{item.dueDate ?? "—"}</td><td>{item.submittedAt ? new Date(item.submittedAt).toLocaleDateString() : "—"}</td><td>{item.requestor.fullName}</td>
              <td><span className={`status-pill status-${item.statusLabel.toLowerCase().replaceAll(" ", "-")}`}>{item.statusLabel}</span></td>
              <td>{canCreate && item.statusLabel === "Draft" ? <Link className="table-action" href={`/payment-requests/${item.id}/edit`}>Edit</Link> : <Link className="table-action" href={`/payment-requests/${item.id}`} aria-label="View request"><ArrowRight size={16} /></Link>}</td>
            </tr>)}
              {!loading && !items.length && <tr><td className="table-empty" colSpan={10}>No payment requests match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="payment-pagination"><span>Page {page} of {pages}</span><div><button className="button button-secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button className="button button-secondary" disabled={page >= pages || loading} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next</button></div></div>
      </section>
    </div>
  );
}
