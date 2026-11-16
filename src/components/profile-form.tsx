"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Save, ShieldCheck, UserRound } from "lucide-react";

export function ProfileForm({
  fullName,
  email,
  role,
  timeZone,
}: {
  fullName: string;
  email: string;
  role: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(fullName);
  const [zone, setZone] = useState(timeZone);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: name, timeZone: zone }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update profile.");
      setMessage("Profile saved.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-layout">
      <section className="panel profile-form-panel">
        <div className="panel-heading">
          <div><h2>Personal information</h2><p>Manage the details associated with your account.</p></div>
          <span className="panel-heading-icon"><UserRound size={18} /></span>
        </div>
        <form className="profile-form" onSubmit={submit}>
          <label className="field-label" htmlFor="full-name">Full name</label>
          <input className="text-input" id="full-name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={120} />
          <label className="field-label" htmlFor="profile-email">JSAN email</label>
          <input className="text-input input-disabled" id="profile-email" value={email} readOnly />
          <p className="field-hint">Your registered employee email cannot be changed here.</p>
          <label className="field-label" htmlFor="profile-role">Assigned role</label>
          <input className="text-input input-disabled" id="profile-role" value={role} readOnly />
          <label className="field-label" htmlFor="profile-time-zone">Time zone</label>
          <select className="text-input" id="profile-time-zone" value={zone} onChange={(event) => setZone(event.target.value)}>
            {["UTC", "America/Los_Angeles", "America/Chicago", "America/New_York", "Europe/London", "Europe/Paris", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"].map((item) => <option value={item} key={item}>{item.replaceAll("_", " ")}</option>)}
          </select>
          <p className="field-hint">Notification timestamps use this zone in the application; stored times remain UTC.</p>
          {error && <p className="form-message form-message-error" role="alert">{error}</p>}
          {message && <p className="form-message form-message-success" role="status"><Check size={15} />{message}</p>}
          <button className="button button-primary" type="submit" disabled={busy || name === fullName && zone === timeZone}>
            <Save size={16} /> {busy ? "Saving..." : "Save changes"}
          </button>
        </form>
      </section>
      <section className="panel security-panel">
        <div className="panel-heading">
          <div><h2>Account access</h2><p>Your access is managed through your assigned role.</p></div>
          <span className="panel-heading-icon"><ShieldCheck size={18} /></span>
        </div>
        <div className="security-detail">
          <span className="security-detail-dot" />
          <span><strong>Secure sign-in</strong><small>Password-protected account</small></span>
          <span className="status-pill status-active">Active</span>
        </div>
        <p className="security-caption">Contact your Accounts Payable administrator if you need changes to your access or role assignment.</p>
      </section>
    </div>
  );
}
