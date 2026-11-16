"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";

type RequestData = {
  id: string;
  transactionId: string;
  status: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  currencyCode: string | null;
  totalPayable: string | null;
  dueDate: string | null;
};
type Currency = { code: string; name: string };

export function PaymentConfirmationForm({ id }: { id: string }) {
  const router = useRouter();
  const [item, setItem] = useState<RequestData | null>(null);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [amount, setAmount] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState("Bank transfer");
  const [account, setAccount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [requestResponse, masterResponse] = await Promise.all([
          fetch(`/api/payment-requests/${id}`),
          fetch("/api/payment-masters"),
        ]);
        const requestData = await requestResponse.json();
        if (!requestResponse.ok) throw new Error(requestData.error ?? "Unable to load payment request.");
        const masterData = await masterResponse.json();
        if (!masterResponse.ok) throw new Error(masterData.error ?? "Unable to load payment currencies.");
        if (active) {
          setItem(requestData);
          setAmount(requestData.totalPayable ?? "");
          setCurrencyCode(requestData.currencyCode ?? "USD");
          setCurrencies(masterData.currencies);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load payment request.");
      }
    }
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proof) { setError("Upload payment proof before confirming payment."); return; }
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("amountPaid", amount);
    form.set("currencyCode", currencyCode);
    form.set("actualPaymentDate", date);
    form.set("paymentReference", reference);
    form.set("paymentMethod", method);
    form.set("paymentAccount", account);
    form.set("remarks", remarks);
    form.set("proof", proof);
    try {
      const response = await fetch(`/api/ap/payments/${id}/confirm`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Payment could not be confirmed.");
      router.push(`/payment-requests/${id}`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Payment could not be confirmed.");
    } finally { setBusy(false); }
  }

  if (error && !item) return <div className="payment-page"><div className="payment-alert" role="alert">{error}</div><Link className="payment-back" href="/workspace/payables/payments"><ArrowLeft size={15} /> Payment queue</Link></div>;
  if (!item) return <div className="payment-page"><p>Loading payment confirmation…</p></div>;
  if (item.status !== "APPROVED") return <div className="payment-page"><div className="payment-alert" role="alert">Only approved and unpaid invoices can be confirmed as paid.</div><Link className="payment-back" href={`/payment-requests/${id}`}><ArrowLeft size={15} /> Transaction details</Link></div>;

  return (
    <div className="payment-page">
      <Link className="payment-back" href="/workspace/payables/payments"><ArrowLeft size={15} /> Payment queue</Link>
      <div className="page-heading payment-heading"><div><span className="eyebrow">{item.transactionId}</span><h1>Confirm external payment</h1><p>This records a payment already made outside PAYTRIVA. It does not initiate a bank transfer.</p></div></div>
      <section className="panel payment-detail-card"><dl className="payment-data-grid confirmation-readonly">
        <div><dt>Transaction ID</dt><dd>{item.transactionId}</dd></div><div><dt>Vendor</dt><dd>{item.vendorName ?? "—"}</dd></div><div><dt>Invoice number</dt><dd>{item.invoiceNumber ?? "—"}</dd></div>
      </dl></section>
      <form className="panel payment-form-section confirmation-form" onSubmit={(event) => void submit(event)}>
        {error && <div className="payment-alert" role="alert">{error}</div>}
        <div className="payment-field-grid">
          <label className="payment-field"><span>Amount paid *</span><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label className="payment-field"><span>Payment currency *</span><select required value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value)}><option value="">Select currency</option>{currencies.map((currency) => <option value={currency.code} key={currency.code}>{currency.code} · {currency.name}</option>)}</select></label>
          <label className="payment-field"><span>Actual payment date *</span><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="payment-field"><span>Payment reference / bank transaction ID *</span><input required maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
          <label className="payment-field"><span>Payment method *</span><select value={method} onChange={(event) => setMethod(event.target.value)}><option>Bank transfer</option><option>Wire transfer</option><option>ACH</option><option>Cheque</option><option>Other</option></select></label>
          <label className="payment-field"><span>Bank account / payment account *</span><input required maxLength={180} value={account} onChange={(event) => setAccount(event.target.value)} /><small>Restricted detail. Access is limited to authorized accounts.</small></label>
          <label className="payment-field payment-wide-field"><span>Payment proof (PDF, JPG, PNG) *</span><input required type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setProof(event.target.files?.[0] ?? null)} />{proof && <small>{proof.name} · {(proof.size / 1024 / 1024).toFixed(2)} MB</small>}</label>
          <label className="payment-field payment-wide-field"><span>Additional remarks</span><textarea rows={3} maxLength={2000} value={remarks} onChange={(event) => setRemarks(event.target.value)} /></label>
        </div>
        <div className="payment-form-actions"><button className="button button-primary" type="submit" disabled={busy}><UploadCloud size={15} /> {busy ? "Recording payment…" : "Confirm payment recorded"}</button></div>
      </form>
    </div>
  );
}
