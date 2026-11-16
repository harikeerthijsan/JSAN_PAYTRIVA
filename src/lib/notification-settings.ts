import "server-only";
import { createDecipheriv, createCipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";

export const notificationCategories = [
  "request_submitted",
  "approval_request",
  "approval_reminder",
  "clarification",
  "approval_decision",
  "payment",
  "ap_updates",
] as const;

export type NotificationCategory = typeof notificationCategories[number];
export const defaultReminderHours = [8, 24, 48] as const;
export const defaultNotificationCategories = Object.fromEntries(notificationCategories.map((key) => [key, true]));

export function validNotificationCategories(value: unknown): Record<NotificationCategory, boolean> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!notificationCategories.every((key) => typeof record[key] === "boolean")) return null;
  return Object.fromEntries(notificationCategories.map((key) => [key, record[key]])) as Record<NotificationCategory, boolean>;
}

export function validReminderHours(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!value.every((hour) => Number.isInteger(hour) && hour >= 1 && hour <= 168)) return null;
  if (value[0] >= value[1] || value[1] >= value[2]) return null;
  return value as number[];
}

function encryptionKey(): Buffer {
  const secret = process.env.NOTIFICATION_SECRETS_KEY;
  if (!secret) throw new Error("NOTIFICATION_SECRETS_KEY_NOT_CONFIGURED");
  return createHash("sha256").update(secret).digest();
}

export function encryptNotificationSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptNotificationSecret(value: string): string {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("NOTIFICATION_SECRET_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

export async function getNotificationSettings() {
  const settings = await db.notificationSettings.findUnique({ where: { id: "default" } });
  return {
    settings,
    categories: validNotificationCategories(settings?.enabledCategories) ?? defaultNotificationCategories,
    reminderHours: validReminderHours(settings?.reminderHours) ?? [...defaultReminderHours],
  };
}
