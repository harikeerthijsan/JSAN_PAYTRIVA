import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { defaultNotificationCategories, validNotificationCategories, type NotificationCategory } from "@/lib/notification-settings";
import type { notificationTemplateKeys } from "@/lib/notification-templates";

type Transaction = Prisma.TransactionClient;
const defaultTemplateKeys: Record<NotificationCategory, typeof notificationTemplateKeys[number]> = {
  request_submitted: "request_submitted",
  approval_request: "approval_request",
  approval_reminder: "approval_reminder",
  clarification: "clarification",
  approval_decision: "approval_confirmation",
  payment: "payment_confirmation",
  ap_updates: "ap_update",
};
type QueueNotificationInput = {
  userId: string;
  requestId?: string | null;
  eventKey: string;
  category: NotificationCategory;
  templateKey?: typeof notificationTemplateKeys[number];
  title: string;
  message: string;
  href?: string | null;
};

export async function queueNotification(tx: Transaction, input: QueueNotificationInput): Promise<void> {
  const settings = await tx.notificationSettings.findUnique({
    where: { id: "default" },
    select: { emailEnabled: true, enabledCategories: true },
  });
  const categories = validNotificationCategories(settings?.enabledCategories) ?? defaultNotificationCategories;
  if (!categories[input.category]) return;

  const recipient = await tx.user.findFirst({
    where: { id: input.userId, isActive: true },
    select: { id: true, email: true },
  });
  if (!recipient) return;

  const request = input.requestId
    ? await tx.paymentRequest.findUnique({
        where: { id: input.requestId },
        select: {
          transactionId: true,
          vendorName: true,
          invoiceNumber: true,
          status: true,
          project: { select: { name: true } },
        },
      })
    : null;
  const context = request
    ? [
        `Transaction: ${request.transactionId}`,
        request.vendorName ? `Vendor: ${request.vendorName}` : null,
        request.invoiceNumber ? `Invoice: ${request.invoiceNumber}` : null,
        request.project?.name ? `Project: ${request.project.name}` : null,
        `Status: ${request.status.replaceAll("_", " ")}`,
      ].filter(Boolean).join(" · ")
    : null;

  await tx.notification.createMany({
    data: [{
      userId: recipient.id,
      requestId: input.requestId ?? null,
      eventKey: input.eventKey,
      category: input.category,
      templateKey: input.templateKey ?? defaultTemplateKeys[input.category],
      title: input.title,
      message: context ? `${input.message}\n${context}` : input.message,
      href: input.href ?? null,
    }],
    skipDuplicates: true,
  });
  const notification = await tx.notification.findFirst({
    where: { userId: recipient.id, eventKey: input.eventKey },
    select: { id: true },
  });
  if (!notification || settings?.emailEnabled === false) return;

  await tx.emailDelivery.createMany({
    data: [{
      notificationId: notification.id,
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      eventKey: `${input.eventKey}:${recipient.id}:email`,
    }],
    skipDuplicates: true,
  });
}

export function notificationEventKey(requestId: string, event: string, actionAt: Date): string {
  return `request:${requestId}:${event}:${actionAt.toISOString()}`;
}
