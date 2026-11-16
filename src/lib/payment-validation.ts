import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((value) => value || undefined);
const optionalId = z.string().cuid().optional().or(z.literal(""));
const optionalDate = z
  .string()
  .optional()
  .or(z.literal(""))
  .transform((value) => value || undefined)
  .refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), "Enter a valid date.");
const optionalAmount = z
  .string()
  .optional()
  .or(z.literal(""))
  .transform((value) => value || undefined)
  .refine(
    (value) => !value || /^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(value),
    "Enter a non-negative amount with up to 6 decimal places.",
  );

export const paymentDraftSchema = z.object({
  action: z.enum(["draft", "submit"]),
  vendorName: optionalText(200),
  description: optionalText(2000),
  billToEntityId: optionalId,
  billFrom: optionalText(200),
  invoiceNumber: optionalText(100),
  invoiceDate: optionalDate,
  serviceStartDate: optionalDate,
  serviceEndDate: optionalDate,
  currencyCode: z.string().trim().toUpperCase().length(3).optional().or(z.literal("")),
  invoiceAmount: optionalAmount,
  taxAmount: optionalAmount,
  dueDate: optionalDate,
  costCenterId: optionalId,
  projectId: optionalId,
  invoiceDocumentId: z.string().cuid().optional().or(z.literal("")),
  attachmentIds: z.array(z.string().cuid()).max(9).optional().default([]),
});

export type PaymentInput = z.infer<typeof paymentDraftSchema>;

export function isValidCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateDraftFields(input: PaymentInput, currencyDecimals = 6): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of ["invoiceDate", "dueDate", "serviceStartDate", "serviceEndDate"] as const) {
    const value = input[field];
    if (value && !isValidCalendarDate(value)) errors[field] = "Enter a valid calendar date.";
  }
  if (input.invoiceDate && isValidCalendarDate(input.invoiceDate)) {
    const invoiceDate = new Date(`${input.invoiceDate}T00:00:00.000Z`);
    const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    if (invoiceDate > today) errors.invoiceDate = "Invoice date cannot be in the future.";
  }
  if (input.invoiceDate && input.dueDate && input.dueDate < input.invoiceDate) {
    errors.dueDate = "Due date cannot be earlier than the invoice date.";
  }
  if (input.serviceStartDate && input.serviceEndDate && input.serviceStartDate > input.serviceEndDate) {
    errors.serviceEndDate = "Service end date cannot be earlier than service start date.";
  }
  for (const field of ["invoiceAmount", "taxAmount"] as const) {
    const value = input[field];
    if (!value) continue;
    if (value.split(".")[1]?.length > currencyDecimals) {
      errors[field] = `This currency allows up to ${currencyDecimals} decimal places.`;
    }
    if (field === "invoiceAmount" && Number(value) <= 0) {
      errors[field] = "Invoice amount must be greater than zero.";
    }
  }
  return errors;
}

export function validateSubmission(
  input: PaymentInput,
  context: {
    currencyDecimals: number;
    now: Date;
    hasInvoiceDocument: boolean;
    hasExchangeRate: boolean;
  },
): Record<string, string> {
  const errors: Record<string, string> = validateDraftFields(input, context.currencyDecimals);
  const required: [keyof PaymentInput, string][] = [
    ["vendorName", "Vendor name is required."],
    ["description", "Payment description is required."],
    ["billToEntityId", "Bill To entity is required."],
    ["billFrom", "Bill From is required."],
    ["invoiceNumber", "Invoice number is required."],
    ["invoiceDate", "Invoice date is required."],
    ["currencyCode", "Invoice currency is required."],
    ["invoiceAmount", "Invoice amount is required."],
    ["dueDate", "Due date is required."],
    ["costCenterId", "Cost center is required."],
    ["projectId", "Project is required."],
  ];
  for (const [field, message] of required) {
    if (!input[field]) errors[field] = message;
  }
  if (!input.invoiceDocumentId && !context.hasInvoiceDocument) {
    errors.invoiceDocumentId = "Upload the invoice document before submitting.";
  }
  if (input.invoiceDate && !isValidCalendarDate(input.invoiceDate)) errors.invoiceDate = "Enter a valid calendar date.";
  if (!context.hasExchangeRate && input.currencyCode) {
    errors.currencyCode = "No exchange rate is available for this invoice date. Ask an administrator to configure one.";
  }
  return errors;
}
