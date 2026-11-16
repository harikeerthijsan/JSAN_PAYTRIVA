import "server-only";
import nodemailer from "nodemailer";

type MailRequest = {
  to: string;
  subject: string;
  actionUrl: string;
  actionLabel: string;
};

export function emailDeliveryConfigured(): boolean {
  if (!process.env.SMTP_HOST?.trim() || !process.env.SMTP_FROM?.trim()) return false;
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) return false;
  try {
    const url = new URL(appUrl);
    return (
      !url.username &&
      !url.password &&
      (process.env.NODE_ENV !== "production" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

export async function sendActionEmail({
  to,
  subject,
  actionUrl,
  actionLabel,
}: MailRequest): Promise<boolean> {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("EMAIL_DELIVERY_NOT_CONFIGURED");
    }
    return false;
  }
  const from = process.env.SMTP_FROM?.trim();
  if (!from) throw new Error("EMAIL_SENDER_NOT_CONFIGURED");

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
  });
  const escapedUrl = actionUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  await transporter.sendMail({
    from,
    to,
    subject,
    text: `${actionLabel}: ${actionUrl}\n\nIf you did not expect this message, you can ignore it.`,
    html: `<p>${actionLabel}</p><p><a href="${escapedUrl}">${actionLabel}</a></p><p>If you did not expect this message, you can ignore it.</p>`,
  });

  return true;
}

export function actionUrl(path: string, token: string): string {
  const baseUrl = process.env.APP_URL?.trim() ?? "";
  if (!baseUrl && process.env.NODE_ENV === "production") {
    throw new Error("APP_URL_NOT_CONFIGURED");
  }
  const resolvedBaseUrl = baseUrl || "http://localhost:3000";
  const url = new URL(path, resolvedBaseUrl);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("APP_URL_MUST_USE_HTTPS");
  }
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}
