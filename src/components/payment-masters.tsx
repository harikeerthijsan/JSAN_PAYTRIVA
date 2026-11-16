"use client";

import { FormEvent, useEffect, useState } from "react";
import { Plus, RefreshCw, ToggleLeft, ToggleRight } from "lucide-react";

type Master = { id?: string; code?: string; name: string; symbol?: string; decimalPlaces?: number; isActive: boolean };
type Data = {
  entities: Master[];
  currencies: (Master & { code: string })[];
  costCenters: (Master & { code: string })[];
  projects: Master[];
  rates: { id: string; currencyCode: string; usdPerUnit: string; source: string; effectiveAt: string }[];
  financialRules: FinancialRule[];
};
type FinancialRule = {
  id: string;
  name: string;
  ruleKind: "WITHHOLDING_TAX" | "OTHER_DEDUCTION";
  calculation: "PERCENTAGE" | "FIXED_AMOUNT";
  value: string;
  currency: { code: string; symbol: string } | null;
  isActive: boolean;
};
type Section = "entity" | "currency" | "costCenter" | "project" | "exchangeRate" | "financialRule";

export function PaymentMasters() {
  const [data, setData] = useState<Data>({ entities: [], currencies: [], costCenters: [], projects: [], rates: [], financialRules: [] });
  const [section, setSection] = useState<Section>("entity");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/payment-masters");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load payment master data.");
      setData(result);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load payment master data.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body: Record<string, unknown> = { type: section };
    if (section === "exchangeRate") {
      body.currencyCode = form.get("currencyCode");
      body.usdPerUnit = form.get("usdPerUnit");
      const date = String(form.get("effectiveDate") || "");
      body.effectiveAt = new Date(`${date}T00:00:00.000Z`).toISOString();
      body.source = form.get("source");
    } else if (section === "financialRule") {
      body.name = form.get("name");
      body.ruleKind = form.get("ruleKind");
      body.calculation = form.get("calculation");
      body.value = form.get("value");
      body.currencyCode = form.get("currencyCode");
    } else {
      body.name = form.get("name");
      if (section === "currency") {
        body.code = form.get("code");
        body.symbol = form.get("symbol");
        body.decimalPlaces = Number(form.get("decimalPlaces"));
      } else if (section === "costCenter") body.code = form.get("code");
      else body.code = form.get("code") || undefined;
    }
    try {
      const response = await fetch("/api/payment-masters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save master data.");
      formElement.reset();
      setNotice(section === "exchangeRate" ? "Exchange rate saved. New submissions will use it for matching invoice dates." : "Master value added.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save master data.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(type: Exclude<Section, "exchangeRate">, item: Master | FinancialRule) {
    const id = type === "currency" ? ("code" in item ? item.code : undefined) : item.id;
    if (!id) return;
    setError("");
    const response = await fetch("/api/payment-masters", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, id, isActive: !item.isActive }) });
    const result = await response.json();
    if (!response.ok) { setError(result.error ?? "Unable to update master data."); return; }
    await load();
  }

  const title = section === "entity" ? "JSAN entities" : section === "currency" ? "Invoice currencies" : section === "costCenter" ? "Cost centers" : section === "project" ? "Projects" : section === "exchangeRate" ? "Exchange rates" : "Financial rules";
  return (
    <div className="payment-page">
      <div className="page-heading payment-heading"><div><span className="eyebrow">ADMINISTRATION</span><h1>Payment master data</h1><p>Configure the dropdown values and exchange rates used by payment requests.</p></div></div>
      {error && <div className="payment-alert" role="alert">{error}</div>}
      {notice && <div className="payment-success" role="status">{notice}</div>}
      <div className="payment-master-tabs">{(["entity", "currency", "costCenter", "project", "exchangeRate", "financialRule"] as Section[]).map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item === "entity" ? "Entities" : item === "currency" ? "Currencies" : item === "costCenter" ? "Cost centers" : item === "project" ? "Projects" : item === "exchangeRate" ? "Exchange rates" : "Financial rules"}</button>)}</div>
      <div className="payment-master-layout">
        <section className="panel payment-master-form">
          <div className="panel-heading"><div><h2>{section === "exchangeRate" ? "Add exchange rate" : section === "financialRule" ? "Add financial rule" : `Add ${section === "costCenter" ? "cost center" : section}`}</h2><p>{section === "exchangeRate" ? "Rate is USD per one unit of the selected currency." : section === "financialRule" ? "Configure a future withholding or deduction rule. Rules are not applied to requests in this phase." : "Dropdown values are persisted in the database."}</p></div><Plus size={18} /></div>
          <form onSubmit={(event) => void submit(event)}>
            {section === "exchangeRate" ? <>
              <label className="payment-field"><span>Currency</span><select name="currencyCode" required><option value="">Select currency</option>{data.currencies.filter((currency) => currency.isActive).map((currency) => <option value={currency.code} key={currency.code}>{currency.code} — {currency.name}</option>)}</select></label>
              <label className="payment-field"><span>USD per unit</span><input name="usdPerUnit" type="number" min="0.000000000001" step="0.000000000001" required /></label>
              <label className="payment-field"><span>Effective date</span><input name="effectiveDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              <label className="payment-field"><span>Rate source</span><input name="source" maxLength={120} required placeholder="Authorized source or provider name" /></label>
            </> : section === "financialRule" ? <>
              <label className="payment-field"><span>Rule name</span><input name="name" maxLength={120} required /></label>
              <label className="payment-field"><span>Rule type</span><select name="ruleKind" required><option value="WITHHOLDING_TAX">Withholding tax</option><option value="OTHER_DEDUCTION">Other deduction</option></select></label>
              <label className="payment-field"><span>Calculation</span><select name="calculation" required><option value="PERCENTAGE">Percentage</option><option value="FIXED_AMOUNT">Fixed amount</option></select></label>
              <label className="payment-field"><span>Value (percent or amount)</span><input name="value" type="number" min="0.000001" step="0.000001" required /></label>
              <label className="payment-field"><span>Currency (required for fixed amount)</span><select name="currencyCode"><option value="">Not applicable</option>{data.currencies.filter((currency) => currency.isActive).map((currency) => <option value={currency.code} key={currency.code}>{currency.code} — {currency.name}</option>)}</select></label>
            </> : <>
              <label className="payment-field"><span>{section === "currency" ? "Currency code" : "Name"}</span><input name={section === "currency" ? "code" : "name"} required maxLength={section === "currency" ? 3 : 160} /></label>
              {section === "currency" && <><label className="payment-field"><span>Currency name</span><input name="name" required maxLength={80} /></label><label className="payment-field"><span>Symbol</span><input name="symbol" required maxLength={8} /></label><label className="payment-field"><span>Decimal places</span><input name="decimalPlaces" type="number" min="0" max="6" required defaultValue="2" /></label></>}
              {(section === "entity" || section === "costCenter" || section === "project") && <label className="payment-field"><span>Code (optional except cost center)</span><input name="code" maxLength={40} required={section === "costCenter"} /></label>}
            </>}
            <button className="button button-primary" type="submit" disabled={busy}><Plus size={15} /> {busy ? "Saving…" : "Add value"}</button>
          </form>
        </section>
        <section className="panel payment-master-list">
          <div className="panel-heading"><div><h2>{title}</h2><p>{loading ? "Loading…" : "Active and inactive configured values"}</p></div><button className="icon-button" aria-label="Refresh master data" onClick={() => void load()}><RefreshCw size={16} /></button></div>
          {section === "exchangeRate" ? <div className="master-value-list">{data.rates.map((rate) => <div className="master-value" key={rate.id}><span><strong>{rate.currencyCode} → USD</strong><small>1 {rate.currencyCode} = {rate.usdPerUnit} USD · {rate.source}</small></span><small>{new Date(rate.effectiveAt).toLocaleDateString()}</small></div>)}{!data.rates.length && <p className="payment-muted">No exchange rates configured.</p>}</div> : section === "financialRule" ? <div className="master-value-list">{data.financialRules.map((rule) => <div className={`master-value${!rule.isActive ? " master-value-inactive" : ""}`} key={rule.id}><span><strong>{rule.name}</strong><small>{rule.ruleKind === "WITHHOLDING_TAX" ? "Withholding tax" : "Other deduction"} · {rule.calculation === "PERCENTAGE" ? `${rule.value}%` : `${rule.currency?.symbol ?? ""} ${rule.value} ${rule.currency?.code ?? ""}`} · {rule.isActive ? "Active" : "Inactive"}</small></span><button className="table-action" onClick={() => void toggle("financialRule", rule)} aria-label={`${rule.isActive ? "Deactivate" : "Activate"} ${rule.name}`}>{rule.isActive ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}</button></div>)}{!data.financialRules.length && <p className="payment-muted">No financial rules configured.</p>}</div> : <div className="master-value-list">{data[section === "entity" ? "entities" : section === "currency" ? "currencies" : section === "costCenter" ? "costCenters" : "projects"].map((item) => <div className={`master-value${!item.isActive ? " master-value-inactive" : ""}`} key={item.id ?? item.code}><span><strong>{item.code ? `${item.code} — ` : ""}{item.name}</strong><small>{item.isActive ? "Active" : "Inactive"}</small></span><button className="table-action" onClick={() => void toggle(section as Exclude<Section, "exchangeRate" | "financialRule">, item)} aria-label={`${item.isActive ? "Deactivate" : "Activate"} ${item.name}`}>{item.isActive ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}</button></div>)}{!data[section === "entity" ? "entities" : section === "currency" ? "currencies" : section === "costCenter" ? "costCenters" : "projects"].length && <p className="payment-muted">No master data configured.</p>}</div>}
        </section>
      </div>
    </div>
  );
}
