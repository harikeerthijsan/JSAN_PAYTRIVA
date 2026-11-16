import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError, requirePermission } from "@/lib/api";
import { deliverNotificationEmail } from "@/lib/notification-email";
import {
  defaultNotificationCategories,
  defaultReminderHours,
  encryptNotificationSecret,
  validNotificationCategories,
  validReminderHours,
} from "@/lib/notification-settings";
import { defaultNotificationTemplates, notificationTemplateKeys } from "@/lib/notification-templates";

const settingsSchema = z.object({
  emailEnabled: z.boolean(),
  enabledCategories: z.record(z.string(), z.boolean()),
  reminderHours: z.array(z.number().int().min(1).max(168)).length(3),
  smtpHost: z.string().trim().max(255).nullable(),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  smtpUser: z.string().trim().max(255).nullable(),
  smtpPassword: z.string().max(1000).optional(),
  smtpFrom: z.string().trim().max(255).nullable(),
  templates: z.array(z.object({
    key: z.enum(notificationTemplateKeys),
    subject: z.string().trim().min(1).max(250),
    body: z.string().trim().min(1).max(4000),
  })).length(notificationTemplateKeys.length),
});

export async function GET() {
  const auth = await requirePermission("platform:admin");
  if ("response" in auth) return auth.response;
  const settings = await db.notificationSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      enabledCategories: defaultNotificationCategories,
      reminderHours: [...defaultReminderHours],
      smtpPort: Number(process.env.SMTP_PORT ?? "587"),
      smtpSecure: process.env.SMTP_SECURE === "true",
    },
    update: {},
  });
  await db.notificationTemplate.createMany({ data: defaultNotificationTemplates, skipDuplicates: true });
  const [templates, deliveries] = await Promise.all([
    db.notificationTemplate.findMany({
      where: { key: { in: [...notificationTemplateKeys] } },
      orderBy: { key: "asc" },
      select: { key: true, subject: true, body: true, updatedAt: true },
    }),
    db.emailDelivery.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, recipientEmail: true, eventKey: true, status: true, attempts: true,
        nextAttemptAt: true, sentAt: true, lastError: true, createdAt: true,
        notification: { select: { title: true, category: true } },
      },
    }),
  ]);
  return NextResponse.json({
    settings: {
      emailEnabled: settings.emailEnabled,
      enabledCategories: validNotificationCategories(settings.enabledCategories) ?? defaultNotificationCategories,
      reminderHours: validReminderHours(settings.reminderHours) ?? [...defaultReminderHours],
      smtpHost: settings.smtpHost ?? process.env.SMTP_HOST ?? "",
      smtpPort: settings.smtpPort,
      smtpSecure: settings.smtpSecure,
      smtpUser: settings.smtpUser ?? process.env.SMTP_USER ?? "",
      smtpFrom: settings.smtpFrom ?? process.env.SMTP_FROM ?? "",
      hasSmtpPassword: Boolean(settings.smtpPasswordCipher || process.env.SMTP_PASSWORD),
      smtpConfigured: Boolean(settings.smtpHost || process.env.SMTP_HOST) &&
        Boolean(settings.smtpFrom || process.env.SMTP_FROM) &&
        Boolean(settings.smtpPasswordCipher || process.env.SMTP_PASSWORD || !settings.smtpUser && !process.env.SMTP_USER) &&
        Boolean(process.env.APP_URL),
    },
    templates,
    deliveries,
  });
}

export async function PATCH(request: Request) {
  const auth = await requirePermission("platform:admin");
  if ("response" in auth) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Notification settings must be valid JSON.", 400); }
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Review the notification settings and template fields.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  const categories = validNotificationCategories(input.enabledCategories);
  const hours = validReminderHours(input.reminderHours);
  if (!categories || !hours) return jsonError("Enable every known notification category and use three increasing reminder intervals.", 400);
  if (new Set(input.templates.map((template) => template.key)).size !== notificationTemplateKeys.length) {
    return jsonError("Each notification type must have exactly one email template.", 400);
  }
  let encryptedPassword: string | undefined;
  if (input.smtpPassword) {
    try { encryptedPassword = encryptNotificationSecret(input.smtpPassword); }
    catch { return jsonError("Configure NOTIFICATION_SECRETS_KEY on the server before saving an SMTP password.", 503); }
  }
  const data = {
    emailEnabled: input.emailEnabled,
    enabledCategories: categories,
    reminderHours: hours,
    smtpHost: input.smtpHost || null,
    smtpPort: input.smtpPort,
    smtpSecure: input.smtpSecure,
    smtpUser: input.smtpUser || null,
    smtpFrom: input.smtpFrom || null,
    ...(encryptedPassword ? { smtpPasswordCipher: encryptedPassword } : {}),
    updatedById: auth.user.id,
  };
  await db.$transaction([
    db.notificationSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    }),
    ...input.templates.map((template) => db.notificationTemplate.upsert({
      where: { key: template.key },
      create: { ...template, updatedById: auth.user.id },
      update: { subject: template.subject, body: template.body, updatedById: auth.user.id },
    })),
  ]);
  return NextResponse.json({ ok: true, hasSmtpPassword: Boolean(encryptedPassword) || Boolean((await db.notificationSettings.findUnique({ where: { id: "default" }, select: { smtpPasswordCipher: true } }))?.smtpPasswordCipher) });
}

export async function POST(request: Request) {
  const auth = await requirePermission("platform:admin");
  if ("response" in auth) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Test delivery details must be valid JSON.", 400); }
  const parsed = z.object({ email: z.string().trim().email().max(254) }).safeParse(body);
  if (!parsed.success) return jsonError("Enter a valid recipient email address.", 400);
  try {
    await deliverNotificationEmail(parsed.data.email, {
      title: "Test email delivery",
      message: `This PAYTRIVA email test was requested by ${auth.user.fullName}.`,
      href: "/admin/notifications",
      actionDateTime: new Date().toLocaleString("en-US", { timeZone: auth.user.timeZone, timeZoneName: "short" }),
      timeZone: auth.user.timeZone,
    }, "approval_request");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Notification test email delivery failed.", error instanceof Error ? error.name : "Unknown delivery error");
    return jsonError("Test email could not be delivered. Verify the provider settings and server logs.", 502);
  }
}
