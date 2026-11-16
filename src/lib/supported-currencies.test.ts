import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_CURRENCIES, SUPPORTED_CURRENCY_CODES } from "./supported-currencies";
import { paymentDraftSchema } from "./payment-validation";

test("payment form options are fixed to EUR, GBP and USD with two decimal places", () => {
  assert.deepEqual(SUPPORTED_CURRENCIES.map((currency) => currency.code), ["EUR", "GBP", "USD"]);
  assert.ok(SUPPORTED_CURRENCIES.every((currency) => currency.isActive && currency.decimalPlaces === 2));
});
test("invoice validation accepts supported currencies and blank drafts, rejecting other currencies", () => {
  for (const code of SUPPORTED_CURRENCY_CODES) {
    assert.ok(paymentDraftSchema.safeParse({ action: "draft", currencyCode: code }).success);
    assert.ok(paymentDraftSchema.safeParse({ action: "draft", currencyCode: code.toLowerCase() }).success);
  }
  assert.ok(paymentDraftSchema.safeParse({ action: "draft", currencyCode: "" }).success);
  assert.ok(paymentDraftSchema.safeParse({ action: "draft" }).success);
  for (const code of ["INR", "JPY", "ABC"]) assert.equal(paymentDraftSchema.safeParse({ action: "draft", currencyCode: code }).success, false);
});
