"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, RotateCw } from "lucide-react";
import { convertFromUsd, CurrencySwitcher, type CurrencyOption, resolveCurrency } from "@/components/currency-switcher";

type Category = "COMPLETED" | "OVERDUE" | "AT_RISK" | "DUE_THIS_WEEK" | "UPCOMING" | "UNSCHEDULED";

type CalendarEntry = {
  id: string;
  transactionId: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  projectName: string;
  invoiceAmount: string | null;
  finalValueUsd: string | null;
  currencyCode: string | null;
  status: string;
  category: Category;
  riskStatus: string;
  dueDate: string | null;
  earliestEligibleDate: string | null;
  scheduledPaymentDate: string | null;
  actualPaymentDate: string | null;
  paymentDate: string | null;
  isWednesday: boolean;
  actualPaidAmountUsd: string | null;
};

type CalendarData = {
  entries: CalendarEntry[];
  categoryCounts: Record<Category, number>;
  wednesdayCycles: string[];
  capped: boolean;
};

type UpcomingCycle = {
  date: string;
  isWednesday: boolean;
  count: number;
  totalUsd: string;
  byCurrency: { code: string; count: number; totalOriginal: string; totalUsd: string }[];
  byProject: { name: string; count: number; totalUsd: string }[];
};

type Summary = {
  reportingCurrency: string;
  totals: { upcomingUsd: string; dueThisWeekUsd: string; overdueUsd: string; atRiskUsd: string; paidUsd: string; outstandingApprovedUsd: string };
  counts: Record<string, number>;
  byCurrency: { code: string; count: number; totalUsd: string; totalOriginal: string }[];
  byProject: { name: string; count: number; totalUsd: string }[];
  byVendor: { name: string; count: number; totalUsd: string }[];
  currencies: CurrencyOption[];
};

const MS_DAY = 86_400_000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const utcMidnight = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * MS_DAY);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CATEGORY_META: Record<Category, { label: string; className: string }> = {
  UPCOMING: { label: "Upcoming", className: "cat-upcoming" },
  DUE_THIS_WEEK: { label: "Due this week", className: "cat-due" },
  OVERDUE: { label: "Overdue", className: "cat-overdue" },
  AT_RISK: { label: "At risk", className: "cat-risk" },
  COMPLETED: { label: "Completed", className: "cat-completed" },
  UNSCHEDULED: { label: "Unscheduled", className: "cat-unscheduled" },
};
const usd = (value: string | null) => (value === null ? "—" : `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const longDay = (iso: string) => utcMidnight(iso).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export function PaymentCalendarView({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<"calendar" | "upcoming" | "financials">("calendar");
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [anchor, setAnchor] = useState<string>(() => isoDay(todayUtc()));
  const [category, setCategory] = useState<Category | "">("");
  const [vendor, setVendor] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  const [calendar, setCalendar] = useState<CalendarData | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingCycle[]>([]);
  const [upcomingNext, setUpcomingNext] = useState<string>("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [displayCurrency, setDisplayCurrency] = useState("USD");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const summaryCurrency = resolveCurrency(summary?.currencies ?? [], displayCurrency);
  const money = (value: string | number | null | undefined) => convertFromUsd(value, summaryCurrency);

  // Visible date range for the active calendar view.
  const range = useMemo(() => {
    const anchorDate = utcMidnight(anchor);
    if (view === "day") return { start: anchorDate, end: anchorDate, days: [anchorDate] };
    if (view === "week") {
      const start = addDays(anchorDate, -anchorDate.getUTCDay());
      const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
      return { start, end: days[6], days };
    }
    const first = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), 1));
    const gridStart = addDays(first, -first.getUTCDay());
    const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
    return { start: days[0], end: days[41], days };
  }, [anchor, view]);

  const loadCalendar = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const query = new URLSearchParams({ from: isoDay(range.start), to: isoDay(range.end) });
      if (category) query.set("category", category);
      if (vendor) query.set("vendor", vendor);
      if (projectId) query.set("projectId", projectId);
      const response = await fetch(`/api/payment-calendar?${query}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load payment calendar.");
      setCalendar(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load payment calendar.");
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, category, vendor, projectId]);

  const loadUpcoming = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (vendor) query.set("vendor", vendor);
      if (projectId) query.set("projectId", projectId);
      const response = await fetch(`/api/payment-calendar/upcoming?${query}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load upcoming payments.");
      setUpcoming(result.cycles);
      setUpcomingNext(result.nextWednesday);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load upcoming payments.");
    } finally {
      setLoading(false);
    }
  }, [vendor, projectId]);

  const loadSummary = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/payment-calendar/summary");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load the financial summary.");
      setSummary(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load the financial summary.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/payment-masters").then((response) => (response.ok ? response.json() : null)).then((data) => {
      if (data?.projects) setProjects(data.projects);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (tab === "calendar") void loadCalendar();
      else if (tab === "upcoming") void loadUpcoming();
      else void loadSummary();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tab, loadCalendar, loadUpcoming, loadSummary]);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of calendar?.entries ?? []) {
      if (!entry.paymentDate) continue;
      (map.get(entry.paymentDate) ?? map.set(entry.paymentDate, []).get(entry.paymentDate)!).push(entry);
    }
    return map;
  }, [calendar]);

  function shift(direction: number) {
    const anchorDate = utcMidnight(anchor);
    if (view === "day") setAnchor(isoDay(addDays(anchorDate, direction)));
    else if (view === "week") setAnchor(isoDay(addDays(anchorDate, direction * 7)));
    else setAnchor(isoDay(new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() + direction, 1))));
  }

  const heading = view === "month"
    ? utcMidnight(anchor).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })
    : `${longDay(isoDay(range.start))}${view === "week" ? ` – ${longDay(isoDay(range.end))}` : ""}`;
  const todayIso = isoDay(todayUtc());

  return (
    <div className="payment-page calendar-page">
      <div className="page-heading payment-heading">
        <div>
          <span className="eyebrow">FINANCIAL TRACKING</span>
          <h1>Payment calendar</h1>
          <p>JSAN pays on a weekly Wednesday cycle with a seven-day minimum lead time. Invoice due dates stay separate from scheduled payment dates.</p>
        </div>
        <div className="calendar-head-actions">
          {canManage && <Link className="button button-secondary" href="/workspace/payables/payments">Manage schedules</Link>}
          <button className="button button-secondary" onClick={() => { if (tab === "calendar") void loadCalendar(); else if (tab === "upcoming") void loadUpcoming(); else void loadSummary(); }}><RotateCw size={15} /> Refresh</button>
        </div>
      </div>

      <nav className="payment-master-tabs calendar-tabs" aria-label="Calendar sections">
        {([["calendar", "Calendar"], ["upcoming", "Upcoming payments"], ["financials", "Financial tracking"]] as const).map(([key, label]) => (
          <button className={tab === key ? "active" : ""} key={key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      {(tab === "calendar" || tab === "upcoming") && (
        <section className="panel ap-queue-filters calendar-filters">
          <label className="payment-field"><span>Vendor</span><input value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="Search vendor" /></label>
          <label className="payment-field"><span>Project</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">All projects</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
          {tab === "calendar" && (
            <label className="payment-field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value as Category | "")}><option value="">All categories</option>{(Object.keys(CATEGORY_META) as Category[]).map((key) => <option value={key} key={key}>{CATEGORY_META[key].label}</option>)}</select></label>
          )}
        </section>
      )}

      {error && <div className="payment-alert" role="alert">{error}</div>}

      {tab === "calendar" && (
        <>
          {calendar && (
            <div className="calendar-category-chips">
              <button className={category === "" ? "active" : ""} onClick={() => setCategory("")}>All</button>
              {(Object.keys(CATEGORY_META) as Category[]).filter((key) => calendar.categoryCounts[key] > 0 || key === category).map((key) => (
                <button key={key} className={`${CATEGORY_META[key].className}${category === key ? " active" : ""}`} onClick={() => setCategory(key)}>
                  {CATEGORY_META[key].label}<span className="chip-count">{calendar.categoryCounts[key]}</span>
                </button>
              ))}
            </div>
          )}
          <div className="calendar-controls">
            <div className="calendar-view-toggle">
              {(["month", "week", "day"] as const).map((key) => <button key={key} className={view === key ? "active" : ""} onClick={() => setView(key)}>{key[0].toUpperCase() + key.slice(1)}</button>)}
            </div>
            <div className="calendar-nav">
              <button className="icon-button" aria-label="Previous" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
              <button className="button button-secondary" onClick={() => setAnchor(isoDay(todayUtc()))}>Today</button>
              <button className="icon-button" aria-label="Next" onClick={() => shift(1)}><ChevronRight size={18} /></button>
              <strong className="calendar-heading-label">{heading}</strong>
            </div>
          </div>

          {loading && <p>Loading payment calendar…</p>}

          {!loading && view === "month" && (
            <div className="calendar-grid-wrap panel">
              <div className="calendar-grid-head">{WEEKDAYS.map((day, index) => <span key={day} className={index === 3 ? "wednesday-col" : ""}>{day}</span>)}</div>
              <div className="calendar-grid">
                {range.days.map((day) => {
                  const iso = isoDay(day);
                  const dayEntries = entriesByDay.get(iso) ?? [];
                  const inMonth = day.getUTCMonth() === utcMidnight(anchor).getUTCMonth();
                  const isWed = day.getUTCDay() === 3;
                  return (
                    <div key={iso} className={`calendar-cell${inMonth ? "" : " muted"}${isWed ? " wednesday-cell" : ""}${iso === todayIso ? " today" : ""}`}>
                      <div className="calendar-cell-head"><span>{day.getUTCDate()}</span>{isWed && <Clock3 size={12} aria-label="Wednesday payment cycle" />}</div>
                      <div className="calendar-cell-entries">
                        {dayEntries.slice(0, 4).map((entry) => (
                          <Link key={entry.id} href={`/payment-requests/${entry.id}`} className={`calendar-pill ${CATEGORY_META[entry.category].className}`} title={`${entry.transactionId} · ${entry.vendorName ?? "Vendor"} · ${usd(entry.finalValueUsd)}`}>
                            {entry.vendorName ?? entry.transactionId} · {usd(entry.finalValueUsd)}
                          </Link>
                        ))}
                        {dayEntries.length > 4 && <span className="calendar-more">+{dayEntries.length - 4} more</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!loading && view !== "month" && (
            <div className={`calendar-list-wrap ${view === "week" ? "calendar-week" : ""}`}>
              {range.days.map((day) => {
                const iso = isoDay(day);
                const dayEntries = entriesByDay.get(iso) ?? [];
                const isWed = day.getUTCDay() === 3;
                return (
                  <section key={iso} className={`panel calendar-day${isWed ? " wednesday-day" : ""}`}>
                    <div className="calendar-day-heading"><CalendarDays size={16} /><div><h2>{longDay(iso)}{isWed && <span className="wednesday-badge"><Clock3 size={12} /> Wednesday cycle</span>}</h2><p>{dayEntries.length} payment{dayEntries.length === 1 ? "" : "s"}</p></div></div>
                    <div className="calendar-items">
                      {dayEntries.map((entry) => (
                        <Link className="calendar-item" href={`/payment-requests/${entry.id}`} key={entry.id}>
                          <div className="calendar-item-main"><strong>{entry.vendorName ?? "Vendor"} · {entry.transactionId}</strong><span>Invoice {entry.invoiceNumber ?? "—"} · {entry.projectName}</span></div>
                          <div className="calendar-item-meta"><span className={`category-tag ${CATEGORY_META[entry.category].className}`}>{CATEGORY_META[entry.category].label}</span>{entry.dueDate && <small>Invoice due {entry.dueDate}</small>}</div>
                          <strong className="calendar-amount">{usd(entry.finalValueUsd)}<small>{entry.invoiceAmount ?? "—"} {entry.currencyCode ?? ""}</small></strong>
                        </Link>
                      ))}
                      {!dayEntries.length && <p className="calendar-empty-day">No payments.</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          {calendar?.capped && <p className="calendar-note">Showing the first 1,000 records for this range. Narrow the filters to see more.</p>}
        </>
      )}

      {tab === "upcoming" && (
        <>
          {loading && <p>Loading upcoming payments…</p>}
          {!loading && (
            <p className="calendar-note">Next Wednesday payment run: <strong>{upcomingNext || "—"}</strong></p>
          )}
          {!loading && !upcoming.length && <section className="panel payment-empty">No upcoming scheduled payments match these filters.</section>}
          <div className="upcoming-grid">
            {upcoming.map((cycle) => (
              <section className="panel upcoming-cycle" key={cycle.date}>
                <div className="upcoming-cycle-head">
                  <div><span className="eyebrow">{cycle.isWednesday ? "WEDNESDAY CYCLE" : "SCHEDULED"}</span><h2>{longDay(cycle.date)}</h2></div>
                  <div className="upcoming-cycle-totals"><strong>{usd(cycle.totalUsd)}</strong><small>{cycle.count} invoice{cycle.count === 1 ? "" : "s"}</small></div>
                </div>
                <div className="upcoming-breakdown">
                  <div><h3>By currency</h3><ul>{cycle.byCurrency.map((row) => <li key={row.code}><span>{row.code}</span><span>{row.totalOriginal} {row.code} · {usd(row.totalUsd)}</span></li>)}</ul></div>
                  <div><h3>By project</h3><ul>{cycle.byProject.map((row) => <li key={row.name}><span>{row.name}</span><span>{usd(row.totalUsd)} · {row.count}</span></li>)}</ul></div>
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {tab === "financials" && (
        <>
          <div className="financials-toolbar">
            <CurrencySwitcher currencies={summary?.currencies ?? []} value={displayCurrency} onChange={setDisplayCurrency} />
          </div>
          {loading && <p>Loading financial summary…</p>}
          {!loading && summary && (
            <>
              <div className="summary-kpis">
                {([
                  ["Upcoming", summary.totals.upcomingUsd, summary.counts.upcoming, "cat-upcoming"],
                  ["Due this week", summary.totals.dueThisWeekUsd, summary.counts.dueThisWeek, "cat-due"],
                  ["Overdue", summary.totals.overdueUsd, summary.counts.overdue, "cat-overdue"],
                  ["At risk", summary.totals.atRiskUsd, summary.counts.atRisk, "cat-risk"],
                  ["Outstanding approved", summary.totals.outstandingApprovedUsd, summary.counts.outstandingApproved, "cat-unscheduled"],
                  ["Paid", summary.totals.paidUsd, summary.counts.paid, "cat-completed"],
                ] as const).map(([label, value, count, className]) => (
                  <div className={`summary-kpi ${className}`} key={label}><span>{label}</span><strong>{money(value)}</strong><small>{count} invoice{count === 1 ? "" : "s"}</small></div>
                ))}
              </div>
              <p className="calendar-note">{displayCurrency === "USD"
                ? "Amounts are in the USD reporting currency, using the rate stored with each transaction."
                : `Shown in ${summaryCurrency.code} (${summaryCurrency.symbol}), converted from USD at the latest rate. Figures are indicative.`}</p>
              <div className="summary-tables">
                <section className="panel"><div className="panel-heading"><h2>By currency</h2></div><table className="summary-table"><thead><tr><th>Currency</th><th>Invoices</th><th>Original</th><th>{summaryCurrency.code}</th></tr></thead><tbody>{summary.byCurrency.map((row) => <tr key={row.code}><td>{row.code}</td><td>{row.count}</td><td>{row.totalOriginal}</td><td>{money(row.totalUsd)}</td></tr>)}{!summary.byCurrency.length && <tr><td colSpan={4}>No data.</td></tr>}</tbody></table></section>
                <section className="panel"><div className="panel-heading"><h2>By project</h2></div><table className="summary-table"><thead><tr><th>Project</th><th>Invoices</th><th>{summaryCurrency.code}</th></tr></thead><tbody>{summary.byProject.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.count}</td><td>{money(row.totalUsd)}</td></tr>)}{!summary.byProject.length && <tr><td colSpan={3}>No data.</td></tr>}</tbody></table></section>
                <section className="panel"><div className="panel-heading"><h2>By vendor</h2></div><table className="summary-table"><thead><tr><th>Vendor</th><th>Invoices</th><th>{summaryCurrency.code}</th></tr></thead><tbody>{summary.byVendor.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.count}</td><td>{money(row.totalUsd)}</td></tr>)}{!summary.byVendor.length && <tr><td colSpan={3}>No data.</td></tr>}</tbody></table></section>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
