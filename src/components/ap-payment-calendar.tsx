"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, RotateCw } from "lucide-react";

type CalendarItem = {
  id: string;
  transactionId: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  projectName: string;
  invoiceAmount: string | null;
  currencyCode: string | null;
  dueDate: string | null;
  plannedPaymentDate: string | null;
  actualPaymentDate: string | null;
  paymentDate: string | null;
  status: string;
  statusLabel: string;
  isDueThisWeek: boolean;
  isOverdue: boolean;
  isWednesday: boolean;
  actualPaidAmount: string | null;
  paidCurrencyCode: string | null;
};
type Project = { id: string; name: string };

export function APPaymentCalendar({ initialView = "all" }: { initialView?: string }) {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState(initialView);
  const [projectId, setProjectId] = useState("");
  const [vendor, setVendor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const params = useMemo(() => {
    const query = new URLSearchParams();
    if (projectId) query.set("projectId", projectId);
    if (vendor) query.set("vendor", vendor);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    return query;
  }, [projectId, vendor, from, to]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [response, masterResponse] = await Promise.all([fetch(`/api/ap/calendar?${params}`), fetch("/api/payment-masters")]);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load payment calendar.");
      setItems(result.items);
      if (masterResponse.ok) setProjects((await masterResponse.json()).projects);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load payment calendar."); }
    finally { setLoading(false); }
  }, [params]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = items.filter((item) => {
    if (view === "week") return item.status === "APPROVED" && item.isDueThisWeek;
    if (view === "overdue") return item.status === "APPROVED" && item.isOverdue;
    if (view === "wednesday") return item.status === "APPROVED" && item.isWednesday;
    if (view === "completed") return item.status === "PAID";
    if (view === "upcoming") return item.status === "APPROVED" && !item.isOverdue;
    return true;
  });
  const grouped = filtered.reduce<Record<string, CalendarItem[]>>((result, item) => {
    const key = item.paymentDate ?? "Unscheduled";
    (result[key] ??= []).push(item);
    return result;
  }, {});

  return (
    <div className="payment-page">
      <div className="page-heading payment-heading"><div><span className="eyebrow">ACCOUNTS PAYABLE</span><h1>Payment calendar</h1><p>Group planned payment dates, invoice due dates, and completed confirmations.</p></div><button className="button button-secondary" onClick={() => void load()}><RotateCw size={15} /> Refresh</button></div>
      <nav className="payment-master-tabs calendar-tabs" aria-label="Payment calendar views">
        {[["all", "All"], ["upcoming", "Upcoming"], ["week", "Due this week"], ["overdue", "Overdue"], ["wednesday", "Scheduled Wednesday"], ["completed", "Completed"]].map(([key, label]) => <button className={view === key ? "active" : ""} key={key} onClick={() => setView(key)}>{label}</button>)}
      </nav>
      <section className="panel ap-queue-filters calendar-filters">
        <label className="payment-field"><span>Project</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">All projects</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
        <label className="payment-field"><span>Vendor</span><input value={vendor} onChange={(event) => setVendor(event.target.value)} /></label>
        <label className="payment-field"><span>Payment date from</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="payment-field"><span>Payment date to</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </section>
      {error && <div className="payment-alert" role="alert">{error}</div>}
      {loading && <p>Loading payment calendar…</p>}
      {!loading && !filtered.length && <section className="panel payment-empty">No payments match this calendar view.</section>}
      {Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right)).map(([date, group]) => <section className="panel calendar-day" key={date}>
        <div className="calendar-day-heading"><CalendarDays size={17} /><div><h2>{date === "Unscheduled" ? "Not scheduled" : new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}</h2><p>{group.length} transaction{group.length === 1 ? "" : "s"}</p></div></div>
        <div className="calendar-items">{group.map((item) => <a className="calendar-item" href={`/payment-requests/${item.id}`} key={item.id}>
          <div className="calendar-item-main"><strong>{item.vendorName ?? "Vendor"} · {item.transactionId}</strong><span>Invoice {item.invoiceNumber ?? "—"} · {item.projectName}</span></div>
          <div className="calendar-item-meta"><span>{item.statusLabel}</span>{item.status === "APPROVED" && item.dueDate && <small>Invoice due {item.dueDate}</small>}{item.isWednesday && <small className="wednesday-badge"><Clock3 size={12} /> Wednesday payment run</small>}{item.status === "PAID" && <small>Paid {item.actualPaidAmount} {item.paidCurrencyCode} · {item.actualPaymentDate}</small>}</div>
          <strong className="calendar-amount">{item.status === "PAID" ? `${item.actualPaidAmount} ${item.paidCurrencyCode}` : `${item.invoiceAmount ?? "—"} ${item.currencyCode ?? ""}`}</strong>
        </a>)}</div>
      </section>)}
    </div>
  );
}
