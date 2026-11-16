"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, CalendarDays, CheckSquare, Square } from "lucide-react";

type PaymentItem = {
  id: string;
  transactionId: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  project: { name: string } | null;
  costCenter: { code: string; name: string } | null;
  currency: { code: string } | null;
  invoiceAmount: string | null;
  finalValueUsd: string | null;
  taxAmount: string | null;
  totalPayable: string | null;
  dueDate: string | null;
  plannedPaymentDate: string | null;
  approvalDate: string | null;
  assignedApprover: string;
  statusLabel: string;
};
type FilterData = { currencies: { code: string; name: string }[]; projects: { id: string; name: string }[]; approvers: { id: string; fullName: string }[] };

export function APPaymentQueue() {
  const [items, setItems] = useState<PaymentItem[]>([]);
  const [filters, setFilters] = useState<FilterData>({ currencies: [], projects: [], approvers: [] });
  const [search, setSearch] = useState("");
  const [vendor, setVendor] = useState("");
  const [projectId, setProjectId] = useState("");
  const [currency, setCurrency] = useState("");
  const [approverId, setApproverId] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [invoiceFrom, setInvoiceFrom] = useState("");
  const [invoiceTo, setInvoiceTo] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [sort, setSort] = useState("dueDate");
  const [direction, setDirection] = useState("asc");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkDate, setBulkDate] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const params = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: "25", sort, direction });
    const values: Record<string, string> = { search, vendor, projectId, currency, approverId, transactionId, invoiceFrom, invoiceTo, dueFrom, dueTo };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
    return query;
  }, [page, sort, direction, search, vendor, projectId, currency, approverId, transactionId, invoiceFrom, invoiceTo, dueFrom, dueTo]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [response, managementResponse] = await Promise.all([
        fetch(`/api/ap/payments?${params}`),
        fetch("/api/ap/management"),
      ]);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load payment processing queue.");
      setItems(result.items);
      setTotal(result.total);
      setPages(Math.max(1, result.pages));
      if (managementResponse.ok) {
        const management = await managementResponse.json();
        setFilters(management.filters);
      }
      setSelected((current) => current.filter((id) => result.items.some((item: PaymentItem) => item.id === id)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load payment processing queue.");
    } finally { setLoading(false); }
  }, [params]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function schedule(ids: string[]) {
    if (!bulkDate || !ids.length) return;
    setError("");
    setMessage("");
    const results = await Promise.all(ids.map(async (id) => {
      const response = await fetch(`/api/ap/payments/${id}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plannedDate: bulkDate }),
      });
      return { id, ok: response.ok, result: await response.json() };
    }));
    const failures = results.filter((result) => !result.ok);
    if (failures.length) setError(`${failures.length} of ${ids.length} schedules could not be saved. ${failures[0].result.error ?? ""}`);
    else setMessage(`${ids.length} payment${ids.length === 1 ? "" : "s"} scheduled for ${bulkDate}.`);
    setSelected([]);
    await load();
  }

  function amount(value: string | null, code?: string) {
    return value ? `${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${code ? ` ${code}` : ""}` : "—";
  }

  return (
    <div className="payment-page">
      <div className="page-heading payment-heading">
        <div><span className="eyebrow">ACCOUNTS PAYABLE</span><h1>Payment processing queue</h1><p>Only approved, unpaid requests are eligible for manual payment confirmation.</p></div>
        <a className="button button-secondary" href={`/api/ap/payments?${new URLSearchParams(params.toString())}&export=csv`}><ArrowDownToLine size={15} /> Export CSV</a>
      </div>
      <section className="panel ap-queue-filters">
        <label className="payment-field"><span>Search</span><input placeholder="Vendor, invoice, project…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <label className="payment-field"><span>Vendor</span><input value={vendor} onChange={(event) => { setVendor(event.target.value); setPage(1); }} /></label>
        <label className="payment-field"><span>Project</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); setPage(1); }}><option value="">All projects</option>{filters.projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label className="payment-field"><span>Currency</span><select value={currency} onChange={(event) => { setCurrency(event.target.value); setPage(1); }}><option value="">All currencies</option>{filters.currencies.map((item) => <option value={item.code} key={item.code}>{item.code}</option>)}</select></label>
        <label className="payment-field"><span>Approver</span><select value={approverId} onChange={(event) => { setApproverId(event.target.value); setPage(1); }}><option value="">All approvers</option>{filters.approvers.map((item) => <option value={item.id} key={item.id}>{item.fullName}</option>)}</select></label>
        <label className="payment-field"><span>Transaction ID</span><input value={transactionId} onChange={(event) => { setTransactionId(event.target.value); setPage(1); }} /></label>
        <label className="payment-field"><span>Invoice from</span><input type="date" value={invoiceFrom} onChange={(event) => { setInvoiceFrom(event.target.value); setPage(1); }} /></label>
        <label className="payment-field"><span>Invoice to</span><input type="date" value={invoiceTo} onChange={(event) => { setInvoiceTo(event.target.value); setPage(1); }} /></label>
        <label className="payment-field"><span>Due from</span><input type="date" value={dueFrom} onChange={(event) => { setDueFrom(event.target.value); setPage(1); }} /></label>
        <label className="payment-field"><span>Due to</span><input type="date" value={dueTo} onChange={(event) => { setDueTo(event.target.value); setPage(1); }} /></label>
        <label className="payment-field"><span>Sort by</span><select value={`${sort}:${direction}`} onChange={(event) => { const [nextSort, nextDirection] = event.target.value.split(":"); setSort(nextSort); setDirection(nextDirection); }}><option value="dueDate:asc">Due date · earliest</option><option value="dueDate:desc">Due date · latest</option><option value="vendorName:asc">Vendor · A–Z</option><option value="invoiceDate:desc">Invoice date · newest</option><option value="transactionId:asc">Transaction ID</option></select></label>
      </section>
      {selected.length > 0 && <div className="panel ap-bulk-bar"><strong>{selected.length} selected</strong><input aria-label="Bulk planned payment date" type="date" value={bulkDate} onChange={(event) => setBulkDate(event.target.value)} /><button className="button button-primary" disabled={!bulkDate} onClick={() => void schedule(selected)}><CalendarDays size={15} /> Schedule selected</button></div>}
      {error && <div className="payment-alert" role="alert">{error}</div>}
      {message && <div className="payment-success" role="status">{message}</div>}
      <section className="panel payment-list-panel">
        <div className="panel-heading"><div><h2>Approved invoices</h2><p>{loading ? "Loading…" : `${total} eligible requests · page ${page} of ${pages}`}</p></div></div>
        <div className="payment-table-wrap"><table className="payment-table ap-processing-table"><thead><tr>
          <th><button className="icon-button" aria-label="Select all rows on page" onClick={() => setSelected(selected.length === items.length ? [] : items.map((item) => item.id))}>{selected.length === items.length && items.length ? <CheckSquare size={16} /> : <Square size={16} />}</button></th>
          <th>Transaction ID</th><th>Vendor / invoice</th><th>Project</th><th>Cost center</th><th>Currency</th><th>Invoice value</th><th>USD equivalent</th><th>Tax</th><th>Total payable</th><th>Due date</th><th>Planned date</th><th>Approval date</th><th>Approver</th><th>Status</th><th />
        </tr></thead><tbody>
          {items.map((item) => <tr key={item.id}>
            <td><input aria-label={`Select ${item.transactionId}`} type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></td>
            <td><Link className="payment-transaction" href={`/payment-requests/${item.id}`}>{item.transactionId}</Link></td>
            <td><strong>{item.vendorName ?? "—"}</strong><small>{item.invoiceNumber ?? "—"}</small></td>
            <td>{item.project?.name ?? "—"}</td><td>{item.costCenter ? `${item.costCenter.code} · ${item.costCenter.name}` : "—"}</td>
            <td>{item.currency?.code ?? "—"}</td><td>{amount(item.invoiceAmount, item.currency?.code)}</td><td>{amount(item.finalValueUsd, "USD")}</td>
            <td>{amount(item.taxAmount, item.currency?.code)}</td><td>{amount(item.totalPayable, item.currency?.code)}</td><td>{item.dueDate ?? "—"}</td>
            <td><input aria-label={`Planned payment date for ${item.transactionId}`} className="inline-date" type="date" value={item.plannedPaymentDate ?? ""} onChange={(event) => {
              const date = event.target.value;
              if (!date) return;
              void fetch(`/api/ap/payments/${item.id}/schedule`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plannedDate: date }) })
                .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error); setMessage(`Payment scheduled for ${date}.`); await load(); })
                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to save schedule."));
            }} /></td>
            <td>{item.approvalDate ? new Date(item.approvalDate).toLocaleDateString() : "—"}</td><td>{item.assignedApprover}</td>
            <td><span className="status-pill status-approved">{item.statusLabel}</span></td>
            <td><Link className="button button-secondary" href={`/workspace/payables/payments/${item.id}`}>Process</Link></td>
          </tr>)}
          {!loading && !items.length && <tr><td className="payment-empty" colSpan={16}>No approved unpaid invoices match these filters.</td></tr>}
        </tbody></table></div>
        <div className="payment-pagination"><span>Page {page} of {pages}</span><div><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button className="button button-secondary" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next</button></div></div>
      </section>
    </div>
  );
}
