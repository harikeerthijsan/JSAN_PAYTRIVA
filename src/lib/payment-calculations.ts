import { Prisma } from "@/generated/prisma/client";

export function calculatePaymentValues(
  invoiceAmount: string,
  taxAmount: string | undefined,
  usdPerUnit: string,
) {
  const invoice = new Prisma.Decimal(invoiceAmount);
  const tax = new Prisma.Decimal(taxAmount || "0");
  const rate = new Prisma.Decimal(usdPerUnit);
  const total = invoice.plus(tax);
  return {
    invoiceAmount: invoice,
    taxAmount: tax,
    totalPayable: total,
    invoiceAmountUsd: invoice.mul(rate),
    finalValueUsd: total.mul(rate),
    exchangeRate: rate,
  };
}

export function duplicateInvoiceKey(vendorName: string, invoiceNumber: string, amount: string) {
  return [vendorName.trim().toLocaleLowerCase("en-US"), invoiceNumber.trim().toLocaleLowerCase("en-US"), new Prisma.Decimal(amount).toFixed(6)].join("\u001f");
}

export function formatAmount(value: Prisma.Decimal | string | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "—";
  return new Prisma.Decimal(value).toFixed(decimals);
}
