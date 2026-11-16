"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, ChevronLeft, ChevronRight, RotateCw } from "lucide-react";

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  href: string | null;
  category: string;
  createdAt: string;
  readAt: string | null;
};
type PageData = { items: NotificationItem[]; total: number; pages: number; page: number; unread: number };
const types = ["request_submitted", "approval_request", "approval_reminder", "clarification", "approval_decision", "payment", "ap_updates"];

export function NotificationCenter({ timeZone }: { timeZone: string }) {
  const [data, setData] = useState<PageData>({ items: [], total: 0, pages: 0, page: 1, unread: 0 });
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const params = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: "30" });
    if (category) query.set("type", category);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (unreadOnly) query.set("unread", "true");
    return query;
  }, [page, category, from, to, unreadOnly]);
  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`/api/notifications?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load notifications.");
      setData(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load notifications."); }
    finally { setLoading(false); }
  }, [params]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function markRead(id?: string) {
    setError("");
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : { all: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update notification status.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update notification status."); }
  }
  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    void load();
  }
  const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  return (
    <div className="payment-page notification-center">
      <div className="page-heading payment-heading"><div><span className="eyebrow">YOUR ACCOUNT</span><h1>Notifications</h1><p>Payment request, approval, AP, and payment updates for your account.</p></div><div className="notification-center-actions"><span className="notification-unread-total">{data.unread} unread</span><button className="button button-secondary" onClick={() => void load()}><RotateCw size={15} /> Refresh</button><button className="button button-primary" disabled={!data.unread} onClick={() => void markRead()}><CheckCheck size={15} /> Mark all read</button></div></div>
      <form className="panel notification-filters" onSubmit={applyFilters}>
        <label className="payment-field"><span>Notification type</span><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">All types</option>{types.map((type) => <option value={type} key={type}>{label(type)}</option>)}</select></label>
        <label className="payment-field"><span>From</span><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
        <label className="payment-field"><span>To</span><input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
        <label className="notification-unread-filter"><input type="checkbox" checked={unreadOnly} onChange={(event) => { setUnreadOnly(event.target.checked); setPage(1); }} /> Unread only</label>
      </form>
      {error && <div className="payment-alert" role="alert">{error}</div>}
      <section className="panel notification-history-panel">
        <div className="panel-heading"><div><h2>History</h2><p>{loading ? "Loading…" : `${data.total} notification${data.total === 1 ? "" : "s"}`}</p></div></div>
        {loading && <p className="payment-empty">Loading notifications…</p>}
        {!loading && !data.items.length && <div className="notification-empty"><Bell size={22} /><strong>No notifications found</strong><span>Try changing the filters or check back later.</span></div>}
        <div className="notification-history-list">{data.items.map((item) => <article className={`notification-history-item${item.readAt ? "" : " notification-unread"}`} key={item.id}>
          <div className="notification-history-icon"><Bell size={17} /></div>
          <div className="notification-history-copy"><div className="notification-history-title"><strong>{item.title}</strong><span>{label(item.category)}</span></div><p>{item.message}</p><small>{new Date(item.createdAt).toLocaleString(undefined, { timeZone })} · {timeZone}</small></div>
          <div className="notification-history-actions">{!item.readAt && <button className="button button-secondary" onClick={() => void markRead(item.id)}>Mark read</button>}{item.href && <Link className="button button-primary" href={item.href} onClick={() => { if (!item.readAt) void markRead(item.id); }}>Open</Link>}</div>
        </article>)}</div>
        <div className="payment-pagination"><span>Page {data.page} of {Math.max(data.pages, 1)}</span><div><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /> Previous</button><button className="button button-secondary" disabled={page >= data.pages} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={15} /></button></div></div>
      </section>
    </div>
  );
}
