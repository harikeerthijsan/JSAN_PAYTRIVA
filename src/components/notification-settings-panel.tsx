"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Check, MailCheck, RotateCw, Save, Send } from "lucide-react";

const categoryLabels: Record<string, string> = {
  request_submitted: "Request submission and resubmission",
  approval_request: "New approval request",
  approval_reminder: "Approval reminders",
  clarification: "Clarifications and returns",
  approval_decision: "Approval and rejection decisions",
  payment: "Payment confirmation",
  ap_updates: "Accounts Payable updates",
};
const templateLabels: Record<string, string> = {
  request_submitted: "Request submission and resubmission",
  approval_request: "New approval request",
  approval_reminder: "Approval reminder",
  clarification: "Clarification and return",
  approval_confirmation: "Approval confirmation",
  rejection: "Rejection",
  payment_confirmation: "Payment confirmation",
  ap_update: "Accounts Payable updates",
};
type Settings = {
  emailEnabled: boolean;
  enabledCategories: Record<string, boolean>;
  reminderHours: number[];
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpFrom: string;
  hasSmtpPassword: boolean;
  smtpConfigured: boolean;
};
type Template = { key: string; subject: string; body: string };
type Delivery = {
  id: string;
  recipientEmail: string;
  eventKey: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  sentAt: string | null;
  lastError: string | null;
  createdAt: string;
  notification: { title: string; category: string };
};

export function NotificationSettingsPanel({ timeZone }: { timeZone: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [password, setPassword] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/admin/notifications");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load notification settings.");
      setSettings(result.settings);
      setTemplates(result.templates);
      setDeliveries(result.deliveries);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load notification settings."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, smtpPassword: password, templates }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save notification settings.");
      setPassword("");
      setMessage("Notification settings and email templates saved.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save notification settings."); }
    finally { setSaving(false); }
  }
  async function sendTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTesting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testEmail }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Test email could not be delivered.");
      setMessage(`Test email sent to ${testEmail}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Test email could not be delivered."); }
    finally { setTesting(false); }
  }
  function updateSetting<Key extends keyof Settings>(key: Key, value: Settings[Key]) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
  }
  function updateTemplate(key: string, field: "subject" | "body", value: string) {
    setTemplates((current) => current.map((template) => template.key === key ? { ...template, [field]: value } : template));
  }

  return (
    <div className="payment-page">
      <div className="page-heading payment-heading"><div><span className="eyebrow">PLATFORM ADMINISTRATION</span><h1>Notification settings</h1><p>Configure email delivery, event categories, reminder intervals, and branded message templates.</p></div><button className="button button-secondary" onClick={() => void load()}><RotateCw size={15} /> Refresh</button></div>
      {error && <div className="payment-alert" role="alert">{error}</div>}
      {message && <div className="payment-success" role="status"><Check size={15} /> {message}</div>}
      {loading || !settings ? <p>Loading notification configuration…</p> : <div className="notification-settings-form">
        <section className="panel notification-settings-section">
          <div className="panel-heading"><div><h2>Email provider</h2><p>{settings.smtpConfigured ? "Email delivery is configured." : "SMTP details are not fully configured. Settings are encrypted at rest; credentials are never returned to the browser."}</p></div><MailCheck size={20} /></div>
          <div className="payment-field-grid">
            <label className="payment-field"><span>SMTP host</span><input value={settings.smtpHost} onChange={(event) => updateSetting("smtpHost", event.target.value)} maxLength={255} /></label>
            <label className="payment-field"><span>SMTP port</span><input type="number" min={1} max={65535} value={settings.smtpPort} onChange={(event) => updateSetting("smtpPort", Number(event.target.value))} /></label>
            <label className="payment-field"><span>SMTP username</span><input value={settings.smtpUser} onChange={(event) => updateSetting("smtpUser", event.target.value)} maxLength={255} /></label>
            <label className="payment-field"><span>From address</span><input value={settings.smtpFrom} onChange={(event) => updateSetting("smtpFrom", event.target.value)} maxLength={255} /></label>
            <label className="payment-field"><span>SMTP password</span><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={settings.hasSmtpPassword ? "Configured; leave blank to keep current" : "Enter provider password"} maxLength={1000} /><small>Never displayed after saving. Requires NOTIFICATION_SECRETS_KEY on the server.</small></label>
            <label className="notification-toggle"><input type="checkbox" checked={settings.smtpSecure} onChange={(event) => updateSetting("smtpSecure", event.target.checked)} /> Use secure TLS connection</label>
            <label className="notification-toggle"><input type="checkbox" checked={settings.emailEnabled} onChange={(event) => updateSetting("emailEnabled", event.target.checked)} /> Enable email notifications</label>
          </div>
          <form className="notification-test-form" onSubmit={(event) => void sendTest(event)}><label className="payment-field"><span>Send a test email to</span><input type="email" required value={testEmail} onChange={(event) => setTestEmail(event.target.value)} /></label><button className="button button-secondary" type="submit" disabled={testing || !testEmail}><Send size={15} /> {testing ? "Sending…" : "Send test"}</button></form>
        </section>
        <section className="panel notification-settings-section">
          <div className="panel-heading"><div><h2>Notification categories</h2><p>Disable a category to stop creating both in-app and email notifications for that event group.</p></div></div>
          <div className="notification-category-grid">{Object.entries(categoryLabels).map(([key, label]) => <label className="notification-toggle" key={key}><input type="checkbox" checked={settings.enabledCategories[key] ?? false} onChange={(event) => updateSetting("enabledCategories", { ...settings.enabledCategories, [key]: event.target.checked })} /><span><strong>{label}</strong><small>{key.replaceAll("_", " ")}</small></span></label>)}</div>
        </section>
        <section className="panel notification-settings-section">
          <div className="panel-heading"><div><h2>Approval reminders</h2><p>Hours from assignment; reminders stop when the assignment is resolved, reassigned, or no longer pending.</p></div></div>
          <div className="reminder-intervals">{settings.reminderHours.map((hour, index) => <label className="payment-field" key={index}><span>{["First reminder", "Second reminder", "Third reminder"][index]}</span><div className="reminder-hour-input"><input type="number" min={1} max={168} value={hour} onChange={(event) => updateSetting("reminderHours", settings.reminderHours.map((value, position) => position === index ? Number(event.target.value) : value))} /><span>hours after assignment</span></div></label>)}</div>
        </section>
        <section className="panel notification-settings-section">
          <div className="panel-heading"><div><h2>Email templates</h2><p>Use {"{{title}}"}, {"{{message}}"}, {"{{transactionId}}"}, {"{{vendorName}}"}, {"{{invoiceNumber}}"}, {"{{projectName}}"}, {"{{invoiceAmountUsd}}"}, {"{{requestorName}}"}, {"{{actionDateTime}}"}, {"{{timeZone}}"}, and {"{{href}}"} placeholders.</p></div></div>
          <div className="notification-template-list">{templates.map((template) => <div className="notification-template" key={template.key}>
            <h3>{templateLabels[template.key] ?? template.key}</h3>
            <label className="payment-field"><span>Subject</span><input value={template.subject} onChange={(event) => updateTemplate(template.key, "subject", event.target.value)} maxLength={250} /></label>
            <label className="payment-field"><span>Message body</span><textarea rows={4} value={template.body} onChange={(event) => updateTemplate(template.key, "body", event.target.value)} maxLength={4000} /></label>
          </div>)}</div>
        </section>
        <div className="notification-settings-submit"><button className="button button-primary" type="button" onClick={() => void save()} disabled={saving}><Save size={15} /> {saving ? "Saving…" : "Save notification settings"}</button></div>
      </div>}
      <section className="panel notification-deliveries-panel">
        <div className="panel-heading"><div><h2>Email delivery history</h2><p>Pending, sent, and failed delivery attempts · timestamps in {timeZone}.</p></div></div>
        <div className="payment-table-wrap"><table className="payment-table"><thead><tr><th>Notification</th><th>Recipient</th><th>Status</th><th>Attempts</th><th>Next attempt / sent</th><th>Last error</th></tr></thead><tbody>
          {deliveries.map((delivery) => <tr key={delivery.id}><td><strong>{delivery.notification.title}</strong><small>{delivery.notification.category.replaceAll("_", " ")}</small></td><td>{delivery.recipientEmail}</td><td><span className={`status-pill status-${delivery.status.toLowerCase()}`}>{delivery.status}</span></td><td>{delivery.attempts}</td><td>{new Date(delivery.sentAt ?? delivery.nextAttemptAt).toLocaleString(undefined, { timeZone })}</td><td>{delivery.lastError ?? "—"}</td></tr>)}
          {!deliveries.length && <tr><td className="payment-empty" colSpan={6}>No email deliveries have been queued.</td></tr>}
        </tbody></table></div>
      </section>
    </div>
  );
}
