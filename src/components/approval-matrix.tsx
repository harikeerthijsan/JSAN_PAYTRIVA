"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";

type Approver = { id: string; fullName: string; email: string; isActive: boolean };
type Threshold = {
  id: string; label: string; minUsd: string; maxUsdExclusive: string | null;
  assignedApproverId: string | null; assignedApprover: Approver | null;
};

export function ApprovalMatrix() {
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/approval-matrix");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load approval matrix.");
      setThresholds(result.thresholds);
      setApprovers(result.approvers);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load approval matrix.");
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function assign(thresholdId: string, approverId: string) {
    setThresholds((current) => current.map((threshold) => threshold.id === thresholdId
      ? { ...threshold, assignedApproverId: approverId || null }
      : threshold));
    setMessage("");
  }

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/approval-matrix", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments: thresholds.map(({ id, assignedApproverId }) => ({ thresholdId: id, approverId: assignedApproverId })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save approval matrix.");
      setMessage("Approval matrix saved. New AP forwards will use these assignments.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save approval matrix.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="payment-page">
      <div className="page-heading payment-heading">
        <div><span className="eyebrow">PAYMENT SETTINGS</span><h1>Approval matrix</h1><p>Assign active Approver-role users to the USD approval bands.</p></div>
        <button className="button button-primary" disabled={busy} onClick={() => void save()}><Save size={15} /> Save matrix</button>
      </div>
      <div className="payment-info workflow-warning-inline"><ShieldCheck size={18} /><span>Approval bands are evaluated against the final USD value saved with the request. Changes apply to new AP forwards; existing assignments remain unchanged.</span></div>
      {thresholds.map((threshold) => {
        const unconfirmed = threshold.minUsd === "40000" && threshold.maxUsdExclusive === "50000";
        return <section className={`panel approval-band${unconfirmed ? " approval-band-warning" : ""}`} key={threshold.id}>
          <div><strong>{threshold.label}</strong><p>{unconfirmed ? "Pending business confirmation. Requests in this range cannot be forwarded until an approver is assigned." : "Select the active employee responsible for requests in this band."}</p></div>
          <label className="payment-field"><span>Assigned approver</span><select value={threshold.assignedApproverId ?? ""} onChange={(event) => assign(threshold.id, event.target.value)}>
            <option value="">Not configured</option>
            {approvers.map((approver) => <option value={approver.id} key={approver.id} disabled={!approver.isActive}>{approver.fullName} · {approver.email}{approver.isActive ? "" : " (inactive)"}</option>)}
          </select></label>
        </section>;
      })}
      {!approvers.length && <div className="payment-info">No active users with the Approver role are available. Assign that role to employees before setting approval thresholds.</div>}
      {error && <div className="payment-alert" role="alert">{error}</div>}
      {message && <div className="payment-success" role="status">{message}</div>}
    </div>
  );
}
