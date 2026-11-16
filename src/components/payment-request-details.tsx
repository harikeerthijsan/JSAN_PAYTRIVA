"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { ArrowDownToLine, ArrowLeft, CalendarDays, FileText, PencilLine, Send, RotateCcw, CircleCheck, CircleX, MessageSquareMore } from "lucide-react";
import { useRouter } from "next/navigation";

type RequestData = {
  id: string;
  requestorId: string;
  transactionId: string;
  status: string;
  statusLabel: string;
  vendorName: string | null;
  description: string | null;
  billFrom: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
  currencyCode: string | null;
  invoiceAmount: string | null;
  invoiceAmountUsd: string | null;
  taxAmount: string | null;
  totalPayable: string | null;
  finalValueUsd: string | null;
  exchangeRate: string | null;
  exchangeRateSource: string | null;
  conversionDate: string | null;
  dueDate: string | null;
  createdAt: string;
  submittedAt: string | null;
  requestor: { fullName: string; email: string };
  billToEntity: { name: string } | null;
  costCenter: { code: string; name: string } | null;
  project: { name: string } | null;
  currency: { code: string; name: string; symbol: string; decimalPlaces: number } | null;
  documents: { id: string; kind: string; filename: string; mimeType: string; sizeBytes: number; createdAt: string }[];
  history: { id: string; action: string; description: string | null; createdAt: string; actorName: string; statusLabel: string | null }[];
  approvalAssignments: { id: string; approverId: string; approver: { fullName: string }; threshold: { label: string }; assignedAt: string; resolvedAt: string | null }[];
  approvalComments: { id: string; action: string; content: string; createdAt: string; actor: { fullName: string } }[];
  clarificationRequests: { id: string; reason: string; createdAt: string; resolvedAt: string | null; createdBy: { fullName: string } }[];
  paymentSchedule: { plannedDate: string | null; earliestEligibleDate: string | null; riskStatus: string; autoScheduled: boolean; remarks: string | null } | null;
  scheduleHistory: { id: string; action: string; actorName: string; scheduledDate: string | null; earliestEligibleDate: string | null; dueDate: string | null; riskStatus: string | null; note: string | null; createdAt: string }[];
  paymentConfirmation: {
    amountPaid: string;
    currencyCode: string;
    amountPaidUsd: string;
    actualPaymentDate: string;
    paymentReference: string;
    paymentMethod: string;
    paymentAccount: string;
    remarks: string | null;
    processedBy: { fullName: string };
    proofDocument: { id: string; filename: string; mimeType: string; sizeBytes: number } | null;
    corrections: { id: string; reason: string; createdAt: string; actorName: string; previousValues: Record<string, unknown>; correctedValues: Record<string, unknown> }[];
  } | null;
};

function amount(value: string | null, currency: string | null, decimals = 2) {
  if (!value) return "—";
  const [whole, fraction = ""] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${(fraction + "0".repeat(decimals)).slice(0, decimals)}${currency ? ` ${currency}` : ""}`;
}

export function PaymentRequestDetails({ id, currentUserId, canEdit, canReview, canApprove, canCorrectPayment }: {
  id: string; currentUserId: string; canEdit: boolean; canReview: boolean; canApprove: boolean; canCorrectPayment: boolean;
}) {
  const router = useRouter();
  const [item, setItem] = useState<RequestData | null>(null);
  const [error, setError] = useState("");
  const [workflowComment, setWorkflowComment] = useState("");
  const [workflowError, setWorkflowError] = useState("");
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctedAmount, setCorrectedAmount] = useState("");
  const [correctedCurrency, setCorrectedCurrency] = useState("");
  const [correctedDate, setCorrectedDate] = useState("");
  const [correctedReference, setCorrectedReference] = useState("");
  const [correctedMethod, setCorrectedMethod] = useState("");
  const [correctedAccount, setCorrectedAccount] = useState("");
  const [correctedRemarks, setCorrectedRemarks] = useState("");
  const [activeCurrencies, setActiveCurrencies] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/payment-requests/${id}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load payment request.");
        if (active) setItem(data);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load payment request."); });
    if (canCorrectPayment) {
      void fetch("/api/payment-masters").then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load payment currencies.");
        if (active) setActiveCurrencies(data.currencies);
      }).catch((reason: unknown) => { if (active) setCorrectionError(reason instanceof Error ? reason.message : "Unable to load payment currencies."); });
    }
    return () => { active = false; };
  }, [id, canCorrectPayment]);

  if (error) return <div className="payment-page"><div className="payment-alert" role="alert">{error}</div><Link href="/payment-requests" className="payment-back"><ArrowLeft size={15} /> Payment requests</Link></div>;
  if (!item) return <div className="payment-page"><p>Loading payment request…</p></div>;
  async function performAction(action: string, requiresComment = false) {
    if (requiresComment && !workflowComment.trim()) {
      setWorkflowError("Add a reason or comment before continuing.");
      return;
    }
    setWorkflowBusy(true);
    setWorkflowError("");
    try {
      const response = await fetch(`/api/payment-requests/${id}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment: workflowComment }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update the workflow.");
      const refreshed = await fetch(`/api/payment-requests/${id}`);
      const updated = await refreshed.json();
      if (!refreshed.ok) throw new Error(updated.error ?? "Workflow was updated, but the request could not be refreshed.");
      setItem(updated);
      setWorkflowComment("");
      router.refresh();
    } catch (reason) {
      setWorkflowError(reason instanceof Error ? reason.message : "Unable to update the workflow.");
    } finally {
      setWorkflowBusy(false);
    }
  }
  function openCorrectionForm() {
    if (!item) return;
    const payment = item.paymentConfirmation;
    if (!payment) return;
    setCorrectedAmount(payment.amountPaid);
    setCorrectedCurrency(payment.currencyCode);
    setCorrectedDate(payment.actualPaymentDate);
    setCorrectedReference(payment.paymentReference);
    setCorrectedMethod(payment.paymentMethod);
    setCorrectedAccount(payment.paymentAccount === "Restricted" ? "" : payment.paymentAccount);
    setCorrectedRemarks(payment.remarks ?? "");
    setCorrectionReason("");
    setCorrectionError("");
    setCorrectionOpen(true);
  }
  async function submitPaymentCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCorrectionBusy(true);
    setCorrectionError("");
    try {
      const response = await fetch(`/api/ap/payments/${id}/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: correctionReason,
          amountPaid: correctedAmount,
          currencyCode: correctedCurrency,
          actualPaymentDate: correctedDate,
          paymentReference: correctedReference,
          paymentMethod: correctedMethod,
          paymentAccount: correctedAccount,
          remarks: correctedRemarks,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Payment correction could not be saved.");
      const refreshed = await fetch(`/api/payment-requests/${id}`);
      const updated = await refreshed.json();
      if (!refreshed.ok) throw new Error(updated.error ?? "Correction saved, but payment details could not be refreshed.");
      setItem(updated);
      setCorrectionOpen(false);
    } catch (reason) {
      setCorrectionError(reason instanceof Error ? reason.message : "Payment correction could not be saved.");
    } finally { setCorrectionBusy(false); }
  }
  const invoice = item.documents.find((document) => document.kind === "INVOICE");
  const attachments = item.documents.filter((document) => document.kind === "ATTACHMENT");
  const isImage = invoice?.mimeType === "image/jpeg";
  const isPdf = invoice?.mimeType === "application/pdf";
  function documentPreview(document: RequestData["documents"][number]) {
    if (document.mimeType === "application/pdf") {
      return <div className="payment-preview"><iframe title={`Preview of ${document.filename}`} src={`/api/payment-documents/${document.id}?preview=1`} /></div>;
    }
    if (document.mimeType === "image/jpeg") {
      return <div className="payment-preview"><Image alt={`Preview of ${document.filename}`} src={`/api/payment-documents/${document.id}?preview=1`} width={900} height={700} unoptimized /></div>;
    }
    return null;
  }
  return (
    <div className="payment-page">
      <Link href="/payment-requests" className="payment-back"><ArrowLeft size={15} /> Payment requests</Link>
      <div className="page-heading payment-heading">
        <div><span className="eyebrow">{item.transactionId}</span><h1>{item.vendorName || "Payment request"}</h1><p>{item.description || "Payment request details and status history."}</p></div>
        <div className="payment-detail-actions"><span className={`status-pill status-${item.statusLabel.toLowerCase().replaceAll(" ", "-")}`}>{item.statusLabel}</span>{canEdit && item.requestorId === currentUserId && ["DRAFT", "NEEDS_INFORMATION"].includes(item.status) && <Link className="button button-primary" href={`/payment-requests/${id}/edit`}><PencilLine size={15} /> {item.status === "DRAFT" ? "Edit draft" : "Update & resubmit"}</Link>}</div>
      </div>
      {item.paymentSchedule && <section className="panel payment-detail-card"><div className="panel-heading"><div><h2>Payment schedule</h2><p>Scheduled on JSAN&apos;s Wednesday cycle (submission + 7 days minimum). The scheduled date is kept separate from the original invoice due date, which is never changed.</p></div>{item.paymentSchedule.riskStatus === "AT_RISK" && <span className="category-tag cat-risk">At risk</span>}</div><dl className="payment-data-grid"><div><dt>Scheduled payment date</dt><dd>{item.paymentSchedule.plannedDate || "Not scheduled"}{item.paymentSchedule.autoScheduled ? " (auto)" : item.paymentSchedule.plannedDate ? " (manual)" : ""}</dd></div><div><dt>Earliest eligible date</dt><dd>{item.paymentSchedule.earliestEligibleDate || "—"}</dd></div><div><dt>Invoice due date</dt><dd>{item.dueDate || "—"}</dd></div><div><dt>Risk status</dt><dd>{item.paymentSchedule.riskStatus === "AT_RISK" ? "At risk — cannot meet due date" : "On track"}</dd></div><div><dt>Schedule remarks</dt><dd>{item.paymentSchedule.remarks || "—"}</dd></div></dl></section>}
      {item.scheduleHistory.length > 0 && <section className="panel payment-detail-card"><div className="panel-heading"><div><h2>Scheduling history</h2><p>Every scheduling calculation and change is retained for audit.</p></div></div><ul className="schedule-history">{item.scheduleHistory.map((entry) => <li key={entry.id}><div className="schedule-history-head"><strong>{entry.action.replaceAll("_", " ")}</strong><small>{new Date(entry.createdAt).toLocaleString()}</small></div><p>{entry.note || "—"}</p><small>{entry.scheduledDate ? `Scheduled ${entry.scheduledDate}` : "Cleared"}{entry.earliestEligibleDate ? ` · Earliest ${entry.earliestEligibleDate}` : ""}{entry.riskStatus ? ` · ${entry.riskStatus === "AT_RISK" ? "At risk" : "On track"}` : ""} · by {entry.actorName}</small></li>)}</ul></section>}
      {item.status === "NEEDS_INFORMATION" && item.requestorId === currentUserId && item.clarificationRequests.filter((entry) => !entry.resolvedAt).map((entry) => (
        <div className="workflow-warning" key={entry.id}><MessageSquareMore size={18} /><div><strong>Clarification requested by {entry.createdBy.fullName}</strong><p>{entry.reason}</p></div></div>
      ))}
      {((canReview && ["PENDING_REVIEW", "UNDER_REVIEW", "PENDING_APPROVAL", "RETURNED"].includes(item.status)) ||
        (canApprove && item.status === "PENDING_APPROVAL" && item.approvalAssignments.some((assignment) => assignment.approverId === currentUserId && !assignment.resolvedAt))) && (
        <section className="panel workflow-actions">
          <div className="panel-heading"><div><h2>{canReview ? "AP review" : "Approval decision"}</h2><p>{canReview ? "Validate the invoice details before forwarding or returning it." : "Review the validated invoice and record your decision."}</p></div></div>
          <label className="payment-field"><span>Comment or reason</span><textarea value={workflowComment} onChange={(event) => setWorkflowComment(event.target.value)} maxLength={2000} rows={3} placeholder="Add review notes; required for return, clarification, or rejection." /></label>
          {workflowError && <div className="payment-alert" role="alert">{workflowError}</div>}
          <div className="workflow-action-buttons">
            {canReview && ["PENDING_REVIEW", "RETURNED"].includes(item.status) && <button className="button button-primary" disabled={workflowBusy} onClick={() => void performAction("start_review")}><PencilLine size={15} /> Start review</button>}
            {canReview && item.status === "UNDER_REVIEW" && <button className="button button-primary" disabled={workflowBusy} onClick={() => void performAction("send_approval")}><Send size={15} /> Send for approval</button>}
            {canReview && ["PENDING_REVIEW", "UNDER_REVIEW", "PENDING_APPROVAL", "RETURNED"].includes(item.status) && <>
              <button className="button button-secondary" disabled={workflowBusy} onClick={() => void performAction("clarification", true)}><MessageSquareMore size={15} /> Request clarification</button>
              <button className="button button-secondary" disabled={workflowBusy} onClick={() => void performAction("return", true)}><RotateCcw size={15} /> Return</button>
              <button className="button button-danger" disabled={workflowBusy} onClick={() => void performAction("ap_reject", true)}><CircleX size={15} /> Reject</button>
            </>}
            {canApprove && item.status === "PENDING_APPROVAL" && item.approvalAssignments.some((assignment) => assignment.approverId === currentUserId && !assignment.resolvedAt) && <>
              <button className="button button-primary" disabled={workflowBusy} onClick={() => void performAction("approve")}><CircleCheck size={15} /> Approve</button>
              <button className="button button-secondary" disabled={workflowBusy} onClick={() => void performAction("request_clarification", true)}><MessageSquareMore size={15} /> Request clarification</button>
              <button className="button button-danger" disabled={workflowBusy} onClick={() => void performAction("reject", true)}><CircleX size={15} /> Reject</button>
            </>}
          </div>
        </section>
      )}
      <div className="payment-detail-grid">
        <section className="panel payment-detail-card"><div className="panel-heading"><div><h2>Invoice information</h2><p>Vendor and billing details</p></div><FileText size={18} /></div>
          <dl className="payment-data-grid">
            <div><dt>Vendor</dt><dd>{item.vendorName || "—"}</dd></div><div><dt>Invoice number</dt><dd>{item.invoiceNumber || "—"}</dd></div>
            <div><dt>Invoice date</dt><dd>{item.invoiceDate || "—"}</dd></div><div><dt>Due date</dt><dd>{item.dueDate || "—"}</dd></div>
            <div><dt>Bill To</dt><dd>{item.billToEntity?.name || "—"}</dd></div><div><dt>Bill From</dt><dd>{item.billFrom || "—"}</dd></div>
            <div><dt>Service period</dt><dd>{item.serviceStartDate || "—"}{item.serviceEndDate ? ` to ${item.serviceEndDate}` : ""}</dd></div>
          </dl>
        </section>
        <section className="panel payment-detail-card"><div className="panel-heading"><div><h2>Financial summary</h2><p>Currency conversion and payable total</p></div><span className="payment-currency-mark">{item.currency?.code ?? "USD"}</span></div>
          <dl className="payment-data-grid">
            <div><dt>Invoice value</dt><dd>{item.currency?.symbol ?? ""} {amount(item.invoiceAmount, item.currency?.code ?? null, item.currency?.decimalPlaces ?? 2)}</dd></div>
            <div><dt>Invoice value (USD)</dt><dd>{amount(item.invoiceAmountUsd, "USD")}</dd></div>
            <div><dt>Tax amount</dt><dd>{amount(item.taxAmount, item.currency?.code ?? null, item.currency?.decimalPlaces ?? 2)}</dd></div>
            <div><dt>Total payable</dt><dd>{amount(item.totalPayable, item.currency?.code ?? null, item.currency?.decimalPlaces ?? 2)}</dd></div>
            <div><dt>Final value (USD)</dt><dd className="payment-final-value">{amount(item.finalValueUsd, "USD")}</dd></div>
            <div><dt>Exchange rate</dt><dd>{item.exchangeRate ? `1 ${item.currency?.code} = ${item.exchangeRate} USD` : "—"}</dd></div>
            <div><dt>Rate source</dt><dd>{item.exchangeRateSource || "—"}</dd></div>
            <div><dt>Conversion date</dt><dd>{item.conversionDate ? new Date(item.conversionDate).toLocaleDateString() : "—"}</dd></div>
          </dl>
        </section>
        <section className="panel payment-detail-card"><div className="panel-heading"><div><h2>Project &amp; requestor</h2><p>Ownership and allocation</p></div><CalendarDays size={18} /></div>
          <dl className="payment-data-grid"><div><dt>Project</dt><dd>{item.project?.name || "—"}</dd></div><div><dt>Cost center</dt><dd>{item.costCenter ? `${item.costCenter.code} — ${item.costCenter.name}` : "—"}</dd></div><div><dt>Requestor</dt><dd>{item.requestor.fullName}</dd></div><div><dt>Work email</dt><dd>{item.requestor.email}</dd></div><div><dt>Created</dt><dd>{new Date(item.createdAt).toLocaleString()}</dd></div><div><dt>Submitted</dt><dd>{item.submittedAt ? new Date(item.submittedAt).toLocaleString() : "Not submitted"}</dd></div></dl>
        </section>
        <section className="panel payment-detail-card"><div className="panel-heading"><div><h2>Invoice &amp; attachments</h2><p>Securely stored request documents</p></div></div>
          {!invoice && !attachments.length && <p className="payment-muted">No documents uploaded.</p>}
          {invoice && <div className="payment-doc-item"><FileText size={18} /><div><strong>{invoice.filename}</strong><small>Invoice · {(invoice.sizeBytes / 1024 / 1024).toFixed(2)} MB</small></div><a className="button button-secondary" href={`/api/payment-documents/${invoice.id}`}><ArrowDownToLine size={15} /> Download</a></div>}
          {attachments.map((document) => <div key={document.id}><div className="payment-doc-item"><FileText size={18} /><div><strong>{document.filename}</strong><small>Attachment · {(document.sizeBytes / 1024 / 1024).toFixed(2)} MB</small></div><a className="button button-secondary" href={`/api/payment-documents/${document.id}`}><ArrowDownToLine size={15} /> Download</a></div>{documentPreview(document)}</div>)}
          {invoice && (isPdf || isImage) && documentPreview(invoice)}
        </section>
      </div>
      {item.paymentConfirmation && <section className="panel payment-detail-card payment-confirmation-details">
        <div className="panel-heading"><div><h2>Payment confirmation</h2><p>Manual confirmation recorded by Accounts Payable</p></div>{canCorrectPayment && <button className="button button-secondary" onClick={openCorrectionForm}>Correct payment details</button>}</div>
        <dl className="payment-data-grid">
          <div><dt>Amount paid</dt><dd>{amount(item.paymentConfirmation.amountPaid, item.paymentConfirmation.currencyCode)}</dd></div>
          <div><dt>Paid amount (USD)</dt><dd>{amount(item.paymentConfirmation.amountPaidUsd, "USD")}</dd></div>
          <div><dt>Actual payment date</dt><dd>{item.paymentConfirmation.actualPaymentDate}</dd></div>
          <div><dt>Payment reference</dt><dd>{item.paymentConfirmation.paymentReference}</dd></div>
          <div><dt>Payment method</dt><dd>{item.paymentConfirmation.paymentMethod}</dd></div>
          <div><dt>Payment account</dt><dd>{item.paymentConfirmation.paymentAccount}</dd></div>
          <div><dt>Processed by</dt><dd>{item.paymentConfirmation.processedBy.fullName}</dd></div>
          <div><dt>Remarks</dt><dd>{item.paymentConfirmation.remarks || "—"}</dd></div>
        </dl>
        {item.paymentConfirmation.proofDocument && <div className="payment-doc-item"><FileText size={18} /><div><strong>{item.paymentConfirmation.proofDocument.filename}</strong><small>Payment proof · {(item.paymentConfirmation.proofDocument.sizeBytes / 1024 / 1024).toFixed(2)} MB</small></div><a className="button button-secondary" href={`/api/payment-documents/${item.paymentConfirmation.proofDocument.id}`}><ArrowDownToLine size={15} /> Download proof</a></div>}
        {!!item.paymentConfirmation.corrections.length && <div className="payment-correction-history"><h3>Payment corrections</h3>{item.paymentConfirmation.corrections.map((correction) => <article className="workflow-comment" key={correction.id}><strong>{correction.actorName} · {new Date(correction.createdAt).toLocaleString()}</strong><p>{correction.reason}</p><small>Previous and corrected values are preserved in the audit record.</small></article>)}</div>}
      </section>}
      {correctionOpen && item.paymentConfirmation && <section className="panel payment-form-section correction-form-panel">
        <div className="panel-heading"><div><h2>Correct confirmed payment</h2><p>A reason is required and prior values remain in the audit history.</p></div><button className="button button-secondary" type="button" onClick={() => setCorrectionOpen(false)}>Cancel</button></div>
        <form className="payment-field-grid" onSubmit={(event) => void submitPaymentCorrection(event)}>
          <label className="payment-field"><span>Correction reason *</span><textarea required minLength={5} maxLength={2000} rows={3} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
          <label className="payment-field"><span>Amount paid *</span><input required value={correctedAmount} onChange={(event) => setCorrectedAmount(event.target.value)} /></label>
          <label className="payment-field"><span>Payment currency *</span><select required value={correctedCurrency} onChange={(event) => setCorrectedCurrency(event.target.value)}>{activeCurrencies.map((currency) => <option value={currency.code} key={currency.code}>{currency.code} · {currency.name}</option>)}</select></label>
          <label className="payment-field"><span>Actual payment date *</span><input required type="date" value={correctedDate} onChange={(event) => setCorrectedDate(event.target.value)} /></label>
          <label className="payment-field"><span>Payment reference *</span><input required maxLength={120} value={correctedReference} onChange={(event) => setCorrectedReference(event.target.value)} /></label>
          <label className="payment-field"><span>Payment method *</span><input required maxLength={80} value={correctedMethod} onChange={(event) => setCorrectedMethod(event.target.value)} /></label>
          <label className="payment-field"><span>Payment account *</span><input required maxLength={180} value={correctedAccount} onChange={(event) => setCorrectedAccount(event.target.value)} /></label>
          <label className="payment-field payment-wide-field"><span>Remarks</span><textarea maxLength={2000} rows={3} value={correctedRemarks} onChange={(event) => setCorrectedRemarks(event.target.value)} /></label>
          {correctionError && <div className="payment-alert payment-wide-field" role="alert">{correctionError}</div>}
          <div className="payment-form-actions payment-wide-field"><button className="button button-primary" type="submit" disabled={correctionBusy}>{correctionBusy ? "Saving correction…" : "Save audited correction"}</button></div>
        </form>
      </section>}
      <section className="panel payment-history-card"><div className="panel-heading"><div><h2>Request history</h2><p>Submission and status events</p></div></div>
        <ol className="payment-history">{item.history.map((entry) => <li key={entry.id}><span className="history-dot" /><div><strong>{entry.description || entry.action.replaceAll("_", " ")}</strong><small>{entry.actorName}{entry.statusLabel ? ` · ${entry.statusLabel}` : ""} · {new Date(entry.createdAt).toLocaleString()}</small></div></li>)}</ol>
      </section>
      {!!item.approvalAssignments.length && <section className="panel payment-history-card"><div className="panel-heading"><div><h2>Approval routing history</h2><p>Assignments and decision comments are preserved for audit.</p></div></div>
        <ol className="payment-history">{item.approvalAssignments.map((assignment) => <li key={assignment.id}><span className="history-dot" /><div><strong>{assignment.approver.fullName} · {assignment.threshold.label}</strong><small>Assigned {new Date(assignment.assignedAt).toLocaleString()}{assignment.resolvedAt ? ` · Completed ${new Date(assignment.resolvedAt).toLocaleString()}` : " · Pending"}</small></div></li>)}</ol>
        {item.approvalComments.map((comment) => <div className="workflow-comment" key={comment.id}><strong>{comment.actor.fullName} · {comment.action.replaceAll("_", " ")}</strong><p>{comment.content}</p><small>{new Date(comment.createdAt).toLocaleString()}</small></div>)}
      </section>}
    </div>
  );
}
