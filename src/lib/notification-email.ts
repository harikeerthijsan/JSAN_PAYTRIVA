import "server-only";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { decryptNotificationSecret, getNotificationSettings } from "@/lib/notification-settings";

type EmailContent = {
  title: string;
  message: string;
  href: string | null;
  transactionId?: string | null;
  vendorName?: string | null;
  invoiceNumber?: string | null;
  projectName?: string | null;
  invoiceAmountUsd?: string | null;
  requestorName?: string | null;
  reminderHour?: number;
  actionDateTime?: string;
  timeZone?: string;
  templateKey?: string;
};

type EmailTemplate = { subject: string; body: string };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (_match, key: string) => values[key] ?? "");
}

export function renderNotificationEmail(content: EmailContent, appUrl: string, template?: EmailTemplate) {
  const safe = (value: string | null | undefined) => escapeHtml(value || "—");
  const transactionLink = content.href ? new URL(content.href, appUrl).toString() : appUrl;
  const reminder = content.reminderHour ? `Reminder: this approval has been waiting for ${content.reminderHour} hours.` : "";
  const values = {
    title: content.title,
    message: content.message,
    transactionId: content.transactionId ?? "",
    vendorName: content.vendorName ?? "",
    invoiceNumber: content.invoiceNumber ?? "",
    projectName: content.projectName ?? "",
    invoiceAmountUsd: content.invoiceAmountUsd ? `$${content.invoiceAmountUsd}` : "",
    requestorName: content.requestorName ?? "",
    actionDateTime: content.actionDateTime ?? new Date().toISOString(),
    timeZone: content.timeZone ?? "UTC",
    href: transactionLink,
  };
  const bodyText = interpolate(template?.body ?? "{{message}}", values);
  const details = [
    ["Transaction ID", content.transactionId],
    ["Vendor", content.vendorName],
    ["Invoice number", content.invoiceNumber],
    ["Project", content.projectName],
    ["Invoice value (USD)", content.invoiceAmountUsd ? `$${content.invoiceAmountUsd}` : null],
    ["Requestor", content.requestorName],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  const rows = details.map(([label, value]) => `<tr><td style="padding:8px 12px;color:#64748b">${escapeHtml(label)}</td><td style="padding:8px 12px;color:#1e293b;font-weight:600">${safe(value)}</td></tr>`).join("");
  return {
    subject: interpolate(template?.subject ?? "PAYTRIVA · {{title}} · {{transactionId}}", values).slice(0, 250),
    text: [
      bodyText,
      ...details.map(([label, value]) => `${label}: ${value}`),
      reminder,
      `Action date/time (${values.timeZone}): ${values.actionDateTime}`,
      transactionLink,
      "PAYTRIVA · JSAN Consulting",
    ].filter(Boolean).join("\n\n"),
    html: `<div style="background:#f3f6fb;padding:32px 12px;font-family:Arial,sans-serif;color:#1e293b"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden"><div style="padding:22px 28px;background:#1d4ed8;color:#fff"><div style="font-size:20px;font-weight:700;letter-spacing:.04em">PAYTRIVA</div><div style="margin-top:4px;font-size:12px;opacity:.9">JSAN CONSULTING · FINANCIAL CONTROL</div></div><div style="padding:28px"><h1 style="font-size:20px;margin:0 0 10px">${escapeHtml(content.title)}</h1><p style="font-size:14px;line-height:1.6;color:#475569">${escapeHtml(bodyText).replaceAll("\n", "<br>")}</p>${reminder ? `<p style="padding:12px;background:#eff6ff;color:#1d4ed8;border-radius:8px">${escapeHtml(reminder)}</p>` : ""}${rows ? `<table style="width:100%;border-collapse:collapse;margin:20px 0">${rows}</table>` : ""}<p style="font-size:12px;color:#64748b">Action date/time (${escapeHtml(values.timeZone)}): ${escapeHtml(values.actionDateTime)}</p><p style="margin:24px 0"><a href="${escapeHtml(transactionLink)}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#fff;border-radius:7px;text-decoration:none;font-weight:600">Open PAYTRIVA</a></p><p style="font-size:12px;color:#64748b">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(transactionLink)}">${escapeHtml(transactionLink)}</a></p></div><div style="padding:18px 28px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px">This is an automated notification from PAYTRIVA. Please do not reply to this email.<br>JSAN Consulting · Enterprise Financial Control</div></div></div>`,
  };
}

export async function deliverNotificationEmail(email: string, content: EmailContent, category: string): Promise<void> {
  const { settings } = await getNotificationSettings();
  if (settings?.emailEnabled === false) throw new Error("EMAIL_DELIVERY_DISABLED");
  const host = settings?.smtpHost?.trim() || process.env.SMTP_HOST?.trim();
  const from = settings?.smtpFrom?.trim() || process.env.SMTP_FROM?.trim();
  const appUrl = process.env.APP_URL?.trim();
  if (!host || !from || !appUrl) throw new Error("EMAIL_DELIVERY_NOT_CONFIGURED");
  const app = new URL(appUrl);
  if (process.env.NODE_ENV === "production" && app.protocol !== "https:") throw new Error("APP_URL_MUST_USE_HTTPS");
  const password = settings?.smtpPasswordCipher
    ? decryptNotificationSecret(settings.smtpPasswordCipher)
    : process.env.SMTP_PASSWORD;
  const user = settings?.smtpUser ?? process.env.SMTP_USER;
  const transport = nodemailer.createTransport({
    host,
    port: settings?.smtpPort ?? Number(process.env.SMTP_PORT ?? "587"),
    secure: settings?.smtpSecure ?? process.env.SMTP_SECURE === "true",
    auth: user && password ? { user, pass: password } : undefined,
  });
  const template = await db.notificationTemplate.findUnique({
    where: { key: content.templateKey ?? category },
    select: { subject: true, body: true },
  });
  const rendered = renderNotificationEmail(content, appUrl, template ?? undefined);
  await transport.sendMail({ from, to: email, subject: rendered.subject, text: rendered.text, html: rendered.html });
}
