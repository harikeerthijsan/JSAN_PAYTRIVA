import assert from "node:assert/strict";
import test from "node:test";
import { redactPaymentAccount } from "@/lib/payment-corrections";

test("payment correction snapshots redact restricted payment accounts", () => {
  const values = { amountPaid: "105.25", paymentAccount: "Account-12345" };
  assert.deepEqual(redactPaymentAccount(values, false), { amountPaid: "105.25", paymentAccount: "Restricted" });
  assert.deepEqual(redactPaymentAccount(values, true), values);
});
