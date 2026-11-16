import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardMoney } from "./dashboard-currency";
const usd = { code: "USD", symbol: "$", usdPerUnit: "1" };
const gbp = { code: "GBP", symbol: "\u00a3", usdPerUnit: "1.25" };
test("converts USD snapshots in the correct direction", () => {
  assert.equal(dashboardMoney("1250", gbp), "\u00a31,000.00");
  assert.equal(dashboardMoney("1250", usd), "$1,250.00");
});
test("rounds exact decimal amounts once, including large and negative values", () => {
  assert.equal(dashboardMoney("1.005", usd), "$1.01");
  assert.equal(dashboardMoney("-125.01", gbp), "-\u00a3100.01");
  assert.equal(dashboardMoney("9007199254740993.01", usd), "$9,007,199,254,740,993.01");
  assert.equal(dashboardMoney(0, gbp), "\u00a30.00");
});
test("does not fabricate amounts for invalid inputs or rates", () => {
  for (const value of [null, undefined, "", "NaN"]) assert.equal(dashboardMoney(value, usd), "\u2014");
  for (const rate of [null, "0", "-1", "bad"]) assert.equal(dashboardMoney("100", { ...gbp, usdPerUnit: rate }), "\u2014");
});
