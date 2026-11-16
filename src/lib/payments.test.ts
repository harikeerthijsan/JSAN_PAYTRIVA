import assert from "node:assert/strict";
import { test } from "node:test";
import { calculatePaymentValues, duplicateInvoiceKey, formatAmount } from "@/lib/payment-calculations";
import { validateFileType } from "@/lib/payment-file-validation";
import { paymentDraftSchema, validateDraftFields, validateSubmission } from "@/lib/payment-validation";
import { addDecimalValues, formatDecimal, multiplyToFixed } from "@/lib/payment-decimal";
import { Prisma } from "@/generated/prisma/client";

test("calculates precise local and USD values with Prisma decimals", () => {
  const result = calculatePaymentValues("123456789012.34", "100.01", "1.234567890123");
  assert.equal(formatAmount(result.totalPayable, 2), "123456789112.35");
  assert.equal(formatAmount(result.invoiceAmountUsd, 6), "152415787532.324963");
  assert.equal(formatAmount(result.finalValueUsd, 6), "152415787655.794098");
  assert.equal(formatAmount(new Prisma.Decimal("0.1").plus("0.2"), 2), "0.30");
});

test("formats client-side currency totals with decimal-string arithmetic", () => {
  assert.equal(addDecimalValues("100.25", "5"), "105.25");
  assert.equal(addDecimalValues("0.001", "0.009"), "0.010");
  assert.equal(formatDecimal("0.1", 2), "0.10");
  assert.equal(formatDecimal("1.999", 2), "2.00");
  assert.equal(multiplyToFixed("123456789012.34", "1.234567890123"), "152415787532.32");
  assert.equal(multiplyToFixed("0.1", "1"), "0.10");
});

test("duplicate key normalizes whitespace, case, and decimal precision", () => {
  assert.equal(
    duplicateInvoiceKey(" Acme Ltd ", " inv-123 ", "100.5"),
    duplicateInvoiceKey("acme ltd", "INV-123", "100.500000"),
  );
  assert.notEqual(duplicateInvoiceKey("Acme Ltd", "INV-123", "100.50"), duplicateInvoiceKey("Acme Ltd", "INV-123", "100.51"));
});

test("invoice uploads require both an allowed extension, MIME type, and matching signature", () => {
  assert.equal(validateFileType("invoice.pdf", "application/pdf", new TextEncoder().encode("%PDF-1.7")), "application/pdf");
  assert.equal(validateFileType("photo.jpg", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(validateFileType("invoice.pdf", "application/pdf", new TextEncoder().encode("not pdf")), null);
  assert.equal(validateFileType("invoice.exe", "application/pdf", new TextEncoder().encode("%PDF-1.7")), null);
});

test("payment draft and submission validations report required fields and date errors", () => {
  const parsed = paymentDraftSchema.safeParse({
    action: "submit",
    vendorName: "",
    invoiceDate: "2025-02-31",
    serviceStartDate: "2025-05-01",
    serviceEndDate: "2025-04-30",
    dueDate: "2025-01-01",
    invoiceAmount: "12.345",
    currencyCode: "USD",
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  const errors = validateDraftFields(parsed.data, 2);
  assert.match(errors.invoiceDate, /valid calendar date/);
  assert.match(errors.serviceEndDate, /earlier than service start/);
  assert.match(errors.dueDate, /earlier than the invoice date/);
  assert.match(errors.invoiceAmount, /up to 2 decimal places/);
  const submissionErrors = validateSubmission(parsed.data, {
    currencyDecimals: 2,
    now: new Date("2026-01-01T00:00:00Z"),
    hasInvoiceDocument: false,
    hasExchangeRate: true,
  });
  assert.match(submissionErrors.vendorName, /required/);
  assert.match(submissionErrors.invoiceDocumentId, /Upload the invoice/);
});
