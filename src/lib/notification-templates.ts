export const notificationTemplateKeys = [
  "request_submitted",
  "approval_request",
  "approval_reminder",
  "clarification",
  "approval_confirmation",
  "rejection",
  "payment_confirmation",
  "ap_update",
] as const;

export const defaultNotificationTemplates = notificationTemplateKeys.map((key) => ({
  key,
  subject: "PAYTRIVA · {{title}} · {{transactionId}}",
  body: "{{message}}\n\nVendor: {{vendorName}}\nInvoice: {{invoiceNumber}}\nProject: {{projectName}}\nAction date/time ({{timeZone}}): {{actionDateTime}}\n\nOpen PAYTRIVA: {{href}}",
}));
