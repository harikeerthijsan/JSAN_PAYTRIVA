"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, FileText, Plus, Save, Send, Trash2, UploadCloud } from "lucide-react";
import { addDecimalValues, formatDecimal, multiplyToFixed } from "@/lib/payment-decimal";

type MasterData = {
  entities: { id: string; name: string }[];
  currencies: { code: string; name: string; symbol: string; decimalPlaces: number }[];
  costCenters: { id: string; name: string; code: string }[];
  projects: { id: string; name: string; code: string | null }[];
  rates: { currencyCode: string; usdPerUnit: string; source: string; effectiveAt: string }[];
};
type FormValues = {
  vendorName: string; description: string; billToEntityId: string; billFrom: string;
  invoiceNumber: string; invoiceDate: string; serviceStartDate: string; serviceEndDate: string;
  currencyCode: string; invoiceAmount: string; taxAmount: string; dueDate: string;
  costCenterId: string; projectId: string;
};
type DocumentInfo = { id: string; kind: "INVOICE" | "ATTACHMENT"; filename: string; mimeType: string; sizeBytes: number };
type FieldErrors = Record<string, string>;

const emptyValues: FormValues = {
  vendorName: "", description: "", billToEntityId: "", billFrom: "", invoiceNumber: "",
  invoiceDate: "", serviceStartDate: "", serviceEndDate: "", currencyCode: "",
  invoiceAmount: "", taxAmount: "", dueDate: "", costCenterId: "", projectId: "",
};

export function PaymentRequestForm({ requestId }: { requestId?: string }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [masters, setMasters] = useState<MasterData>({ entities: [], currencies: [], costCenters: [], projects: [], rates: [] });
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [masterResponse, requestResponse] = await Promise.all([
          fetch("/api/payment-masters"),
          requestId ? fetch(`/api/payment-requests/${requestId}`) : Promise.resolve(null),
        ]);
        if (!masterResponse.ok) throw new Error("Unable to load payment dropdowns. Ask an administrator to configure them.");
        const masterData = await masterResponse.json();
        if (active) setMasters(masterData);
        if (requestResponse) {
          const item = await requestResponse.json();
          if (!requestResponse.ok) throw new Error(item.error ?? "Unable to load this draft.");
          if (item.status !== "DRAFT" && item.status !== "NEEDS_INFORMATION") {
            throw new Error("Only draft requests or requests awaiting clarification can be edited.");
          }
          if (active) {
            setValues({
              vendorName: item.vendorName ?? "", description: item.description ?? "", billToEntityId: item.billToEntityId ?? "",
              billFrom: item.billFrom ?? "", invoiceNumber: item.invoiceNumber ?? "", invoiceDate: item.invoiceDate ?? "",
              serviceStartDate: item.serviceStartDate ?? "", serviceEndDate: item.serviceEndDate ?? "",
              currencyCode: item.currencyCode ?? "", invoiceAmount: item.invoiceAmount ?? "", taxAmount: item.taxAmount ?? "",
              dueDate: item.dueDate ?? "", costCenterId: item.costCenterId ?? "", projectId: item.projectId ?? "",
            });
            setDocuments(item.documents);
          }
        }
      } catch (reason) {
        if (active) setMessage(reason instanceof Error ? reason.message : "Unable to load payment request.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [requestId]);

  const selectedCurrency = masters.currencies.find((currency) => currency.code === values.currencyCode);
  const dateLimit = values.invoiceDate ? new Date(`${values.invoiceDate}T23:59:59.999Z`).getTime() : Number.POSITIVE_INFINITY;
  const selectedRate = masters.rates.find((item) => item.currencyCode === values.currencyCode && new Date(item.effectiveAt).getTime() <= dateLimit);
  const rate = values.currencyCode === "USD" ? "1" : selectedRate?.usdPerUnit ?? "";
  const usdInvoice = values.invoiceAmount && rate ? multiplyToFixed(values.invoiceAmount, rate) : "—";
  const totalLocal = formatDecimal(addDecimalValues(values.invoiceAmount || "0", values.taxAmount || "0"), selectedCurrency?.decimalPlaces ?? 2);
  const usdFinal = rate ? multiplyToFixed(totalLocal, rate) : "—";
  const invoiceDocument = documents.find((document) => document.kind === "INVOICE");
  const attachmentDocuments = documents.filter((document) => document.kind === "ATTACHMENT");

  function setField<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  async function uploadFile(id: string, file: File, kind: "INVOICE" | "ATTACHMENT", replaceExisting = false): Promise<DocumentInfo> {
    const formData = new FormData();
    formData.set("file", file);
    formData.set("kind", kind);
    const response = await fetch(`/api/payment-requests/${id}/documents${replaceExisting ? "?replace=1" : ""}`, { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `Unable to upload ${file.name}.`);
    return data;
  }

  async function removeDocument(document: DocumentInfo) {
    if (!requestId || busy) return;
    const response = await fetch(`/api/payment-requests/${requestId}/documents?documentId=${encodeURIComponent(document.id)}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? "Unable to remove the document."); return; }
    setDocuments((current) => current.filter((entry) => entry.id !== document.id));
  }

  async function save(event: { preventDefault(): void }, action: "draft" | "submit") {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setErrors({});
    try {
      let id = requestId ?? "";
      if (!id) {
        const createdResponse = await fetch("/api/payment-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...values, action: "draft" }),
        });
        const created = await createdResponse.json();
        if (!createdResponse.ok) throw Object.assign(new Error(created.error ?? "Unable to save draft."), { fields: created.fields });
        if (typeof created.id !== "string") throw new Error("Unable to create the payment draft.");
        id = created.id;
      }
      const currentInvoice = documents.find((document) => document.kind === "INVOICE");
      let invoiceId = currentInvoice?.id;
      if (invoiceFile) {
        const uploaded = await uploadFile(id, invoiceFile, "INVOICE", Boolean(currentInvoice));
        if (currentInvoice) {
          const removeResponse = await fetch(`/api/payment-requests/${id}/documents?documentId=${encodeURIComponent(currentInvoice.id)}`, { method: "DELETE" });
          if (!removeResponse.ok) throw new Error("The new invoice was uploaded, but the previous invoice could not be removed.");
        }
        invoiceId = uploaded.id;
        setDocuments((current) => [...current.filter((doc) => doc.kind !== "INVOICE"), uploaded]);
        setInvoiceFile(null);
      }
      const attachments = documents.filter((document) => document.kind === "ATTACHMENT");
      for (const file of attachmentFiles) attachments.push(await uploadFile(id, file, "ATTACHMENT"));
      setDocuments((current) => [...current.filter((document) => document.kind !== "ATTACHMENT"), ...attachments]);
      setAttachmentFiles([]);

      const updateResponse = await fetch(`/api/payment-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          action,
          invoiceDocumentId: invoiceId,
          attachmentIds: attachments.map((document) => document.id),
        }),
      });
      const updated = await updateResponse.json();
      if (!updateResponse.ok) {
        if (updated.fields) setErrors(updated.fields);
        throw new Error(updated.error ?? "Unable to save payment request.");
      }
      router.push(action === "submit" ? `/payment-requests/${id}` : `/payment-requests/${id}`);
      router.refresh();
    } catch (reason) {
      const failure = reason as Error & { fields?: FieldErrors };
      if (failure.fields) setErrors(failure.fields);
      setMessage(failure.message || "Unable to save payment request.");
    } finally {
      setBusy(false);
    }
  }

  function field<K extends keyof FormValues>(name: K, label: string, type = "text", required = false, hint?: string) {
    return (
      <label className="payment-field" key={name}>
        <span>{label}{required && <b> *</b>}</span>
        <input type={type} value={values[name]} onChange={(event) => setField(name, event.target.value)} />
        {hint && <small>{hint}</small>}
        {errors[name] && <small className="field-error" role="alert">{errors[name]}</small>}
      </label>
    );
  }

  function selectField<K extends "billToEntityId" | "currencyCode" | "costCenterId" | "projectId">(
    name: K, label: string, entries: { value: string; label: string }[], required = false,
  ) {
    return (
      <label className="payment-field" key={name}>
        <span>{label}{required && <b> *</b>}</span>
        <select value={values[name]} onChange={(event) => setField(name, event.target.value)}>
          <option value="">Select {label.toLowerCase()}</option>
          {entries.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select>
        {errors[name] && <small className="field-error" role="alert">{errors[name]}</small>}
      </label>
    );
  }

  if (loading) return <div className="payment-page"><p>Loading payment request…</p></div>;
  return (
    <div className="payment-page">
      <Link href="/payment-requests" className="payment-back"><ArrowLeft size={15} /> Payment requests</Link>
      <div className="page-heading payment-heading"><div><span className="eyebrow">{requestId ? "REQUEST UPDATE" : "NEW REQUEST"}</span><h1>{requestId ? "Edit payment request" : "Create payment request"}</h1><p>{requestId ? "Update the requested information and resubmit to AP for review." : "Enter invoice and project details. Drafts remain private until submitted."}</p></div></div>
      {message && <div className="payment-alert" role="alert">{message}</div>}
      <form className="payment-form" onSubmit={(event) => void save(event, "submit")}>
        <section className="panel payment-form-section">
          <div className="payment-section-title"><span>01</span><div><h2>Vendor &amp; invoice information</h2><p>Provide the details as shown on the invoice.</p></div></div>
          <div className="payment-field-grid">
            {field("vendorName", "Vendor / merchant / driver name", "text", true)}
            {field("invoiceNumber", "Invoice number", "text", true)}
            {field("description", "Payment description", "text", true)}
            {selectField("billToEntityId", "Bill To entity", masters.entities.map((item) => ({ value: item.id, label: item.name })), true)}
            {field("billFrom", "Bill From", "text", true)}
            {field("invoiceDate", "Invoice date", "date", true)}
            {field("serviceStartDate", "Service start date", "date")}
            {field("serviceEndDate", "Service end date", "date")}
          </div>
        </section>
        <section className="panel payment-form-section">
          <div className="payment-section-title"><span>02</span><div><h2>Financial information</h2><p>Amounts are calculated using the saved exchange rate for the invoice date.</p></div></div>
          <div className="payment-field-grid">
            {selectField("currencyCode", "Invoice currency", masters.currencies.map((item) => ({ value: item.code, label: `${item.code} — ${item.name} (${item.symbol})` })), true)}
            {field("invoiceAmount", `Invoice value (${values.currencyCode || "local currency"})`, "number", true, selectedCurrency ? `Enter up to ${selectedCurrency.decimalPlaces} decimal places.` : undefined)}
            {field("taxAmount", "Tax amount (optional)", "number")}
            <div className="payment-calculation"><span>Total payable</span><strong>{selectedCurrency?.symbol ?? ""} {totalLocal} {values.currencyCode}</strong><small>Invoice value plus tax</small></div>
            <div className="payment-calculation"><span>Invoice value (USD)</span><strong>{usdInvoice === "—" ? "—" : `$${usdInvoice}`}</strong><small>{rate ? `Rate: ${rate} USD per unit · ${selectedRate ? new Date(selectedRate.effectiveAt).toLocaleDateString() : "USD base currency"}` : "No applicable rate configured"}</small></div>
            <div className="payment-calculation payment-calculation-highlight"><span>Final value (USD)</span><strong>{usdFinal === "—" ? "—" : `$${usdFinal}`}</strong><small>{rate ? "Calculated with the available rate" : "Exchange rate required for submission"}</small></div>
          </div>
          {errors.currencyCode && <small className="field-error">{errors.currencyCode}</small>}
        </section>
        <section className="panel payment-form-section">
          <div className="payment-section-title"><span>03</span><div><h2>Payment &amp; project information</h2><p>Assign a due date and the appropriate financial project.</p></div></div>
          <div className="payment-field-grid">
            {field("dueDate", "Due date", "date", true)}
            {selectField("costCenterId", "Cost center", masters.costCenters.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}` })), true)}
            {selectField("projectId", "Project name", masters.projects.map((item) => ({ value: item.id, label: item.code ? `${item.code} — ${item.name}` : item.name })), true)}
          </div>
        </section>
        <section className="panel payment-form-section">
          <div className="payment-section-title"><span>04</span><div><h2>Invoice &amp; attachments</h2><p>PDF, XLS, XLSX, and JPG/JPEG · up to 20 MB per file and 50 MB total.</p></div></div>
          <div className="payment-upload-grid">
            <label className="payment-upload">
              <UploadCloud size={22} /><strong>Invoice document *</strong><small>Upload a PDF, spreadsheet, or JPG image</small>
              <input type="file" accept=".pdf,.xls,.xlsx,.jpg,.jpeg,application/pdf,image/jpeg" onChange={(event) => setInvoiceFile(event.target.files?.[0] ?? null)} />
            </label>
            <label className="payment-upload">
              <Plus size={22} /><strong>Additional attachments</strong><small>Optional supporting documents</small>
              <input type="file" multiple accept=".pdf,.xls,.xlsx,.jpg,.jpeg,application/pdf,image/jpeg" onChange={(event) => setAttachmentFiles((current) => [...current, ...Array.from(event.target.files ?? [])])} />
            </label>
          </div>
          {errors.invoiceDocumentId && <small className="field-error">{errors.invoiceDocumentId}</small>}
          <div className="payment-file-list">
            {invoiceDocument && <div className="payment-file-item"><FileText size={17} /><span><strong>{invoiceFile ? `${invoiceDocument.filename} (uploaded)` : invoiceDocument.filename}</strong><small>Invoice · {(invoiceDocument.sizeBytes / 1024 / 1024).toFixed(2)} MB</small></span><button type="button" className="icon-button" aria-label="Remove invoice" onClick={() => void removeDocument(invoiceDocument)}><Trash2 size={16} /></button></div>}
            {invoiceFile && <div className="payment-file-item"><FileText size={17} /><span><strong>{invoiceFile.name}</strong><small>Selected invoice · {(invoiceFile.size / 1024 / 1024).toFixed(2)} MB</small></span><button type="button" className="icon-button" aria-label="Clear selected invoice" onClick={() => setInvoiceFile(null)}><Trash2 size={16} /></button></div>}
            {attachmentDocuments.map((document) => <div className="payment-file-item" key={document.id}><FileText size={17} /><span><strong>{document.filename}</strong><small>Attachment · {(document.sizeBytes / 1024 / 1024).toFixed(2)} MB</small></span><button type="button" className="icon-button" aria-label={`Remove ${document.filename}`} onClick={() => void removeDocument(document)}><Trash2 size={16} /></button></div>)}
            {attachmentFiles.map((file, index) => <div className="payment-file-item" key={`${file.name}-${index}`}><FileText size={17} /><span><strong>{file.name}</strong><small>Selected attachment · {(file.size / 1024 / 1024).toFixed(2)} MB</small></span><button type="button" className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => setAttachmentFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))}><Trash2 size={16} /></button></div>)}
          </div>
        </section>
        <div className="payment-form-actions"><Link className="button button-secondary" href="/payment-requests">Cancel</Link><button className="button button-secondary" type="button" disabled={busy} onClick={() => void save({ preventDefault() {} }, "draft")}><Save size={16} /> Save draft</button><button className="button button-primary" type="submit" disabled={busy}><Send size={15} /> {busy ? "Saving…" : "Submit request"}</button></div>
      </form>
    </div>
  );
}
