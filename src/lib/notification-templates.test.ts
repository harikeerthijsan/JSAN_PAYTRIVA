import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultNotificationTemplates, notificationTemplateKeys } from "./notification-templates";

test("notification email templates cover each distinct request, approval, and payment event", () => {
  assert.deepEqual(notificationTemplateKeys, [
    "request_submitted",
    "approval_request",
    "approval_reminder",
    "clarification",
    "approval_confirmation",
    "rejection",
    "payment_confirmation",
    "ap_update",
  ]);
  assert.equal(new Set(defaultNotificationTemplates.map((template) => template.key)).size, notificationTemplateKeys.length);
  assert.ok(defaultNotificationTemplates.every((template) => template.subject.includes("{{title}}") && template.body.includes("{{href}}")));
});
