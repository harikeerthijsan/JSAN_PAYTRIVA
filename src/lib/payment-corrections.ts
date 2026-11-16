import type { Prisma } from "@/generated/prisma/client";

export function redactPaymentAccount(values: Prisma.JsonValue, canReadPaymentAccount: boolean): Prisma.JsonValue {
  if (canReadPaymentAccount || values === null || typeof values !== "object" || Array.isArray(values)) return values;
  return { ...values, paymentAccount: "Restricted" };
}
