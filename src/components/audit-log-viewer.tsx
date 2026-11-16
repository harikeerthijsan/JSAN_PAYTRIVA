"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { FormEvent } from "react";

type AuditEntry = {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  previousValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

const pageSize = 25;

function formatValue(value: unknown) {
  return value == null ? "—" : JSON.stringify(value, null, 2);
}

export function AuditLogViewer() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedAction, setAppliedAction] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (appliedSearch) params.set("search", appliedSearch);
    if (appliedAction) params.set("action", appliedAction);
    if (appliedFrom) params.set("from", `${appliedFrom}T00:00:00.000Z`);
    if (appliedTo) params.set("to", `${appliedTo}T23:59:59.999Z`);
    try {
      const response = await fetch(`/api/admin/audit?${params.toString()}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load audit entries.");
      setEntries(result.entries);
      setTotal(result.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load audit entries.");
    } finally {
      setLoading(false);
    }
  }, [appliedAction, appliedFrom, appliedSearch, appliedTo, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadEntries(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadEntries]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
    setAppliedAction(action.trim());
    setAppliedFrom(from);
    setAppliedTo(to);
  }

  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

  return (
    <div className="audit-viewer">
      <form className="audit-filters" onSubmit={applyFilters}>
        <label className="audit-search">
          <span className="sr-only">Search audit records</span>
          <Search size={16} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search user, transaction, or summary" />
        </label>
        <label className="payment-field">
          <span>Action</span>
          <input value={action} onChange={(event) => setAction(event.target.value)} placeholder="e.g. PAYMENT_APPROVED" />
        </label>
        <label className="payment-field">
          <span>From</span>
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="payment-field">
          <span>To</span>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <button className="button button-primary" type="submit">Apply filters</button>
      </form>

      {error && <div className="payment-alert" role="alert">{error}</div>}

      <section className="panel audit-table-panel" aria-label="Audit records">
        <div className="panel-heading">
          <div><h2>Activity history</h2><p>{loading ? "Loading audit entries…" : `${total.toLocaleString()} recorded actions`}</p></div>
        </div>
        <div className="audit-list">
          {!loading && entries.length === 0 && <p className="audit-empty">No audit entries match these filters.</p>}
          {entries.map((entry) => (
            <article className="audit-entry" key={entry.id}>
              <div className="audit-entry-main">
                <span className="audit-action">{entry.action.replaceAll("_", " ")}</span>
                <strong>{entry.actorName}</strong>
                <span>{entry.summary ?? `${entry.entityType}${entry.entityId ? ` · ${entry.entityId}` : ""}`}</span>
                <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
              </div>
              <details className="audit-entry-details">
                <summary>Details</summary>
                <dl>
                  <div><dt>Actor ID</dt><dd>{entry.actorId ?? "System"}</dd></div>
                  <div><dt>Entity</dt><dd>{entry.entityType}{entry.entityId ? ` · ${entry.entityId}` : ""}</dd></div>
                  <div><dt>IP address</dt><dd>{entry.ipAddress ?? "Not recorded"}</dd></div>
                  <div><dt>Device</dt><dd>{entry.userAgent ?? "Not recorded"}</dd></div>
                  {entry.previousValue != null && <div className="audit-json"><dt>Previous value</dt><dd><pre>{formatValue(entry.previousValue)}</pre></dd></div>}
                  {entry.newValue != null && <div className="audit-json"><dt>New value</dt><dd><pre>{formatValue(entry.newValue)}</pre></dd></div>}
                </dl>
              </details>
            </article>
          ))}
        </div>
        <div className="audit-pagination">
          <span>Showing {firstItem}–{lastItem} of {total.toLocaleString()}</span>
          <div>
            <button className="button button-secondary" type="button" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={16} /></button>
            <span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
            <button className="button button-secondary" type="button" aria-label="Next page" disabled={lastItem >= total || loading} onClick={() => setPage((current) => current + 1)}><ChevronRight size={16} /></button>
          </div>
        </div>
      </section>
    </div>
  );
}
