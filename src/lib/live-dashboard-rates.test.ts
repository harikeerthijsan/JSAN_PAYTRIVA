import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLiveDashboardRates } from "./live-dashboard-rates";
import { dashboardMoney } from "./dashboard-currency";

const now = new Date("2026-11-16T12:00:00Z");
function mockFetch(change: (code: string) => unknown = () => ({})): typeof fetch {
  return async (input, options) => {
    const url = String(input);
    const code = url.includes("/gbp/") ? "GBP" : "EUR";
    assert.ok(url.startsWith("https://api.frankfurter.dev/v2/rate/"));
    assert.equal(options?.next?.revalidate, 3600);
    assert.ok(options?.signal);
    return Response.json({ base: code, quote: "USD", rate: code === "GBP" ? 1.25 : 1.1, date: "2026-11-16", ...change(code) as object });
  };
}
test("online quotes provide USD, GBP and EUR without master data and convert in the correct direction", async () => {
  const result = await loadLiveDashboardRates(mockFetch(), now);
  assert.deepEqual(result.currencies.map((item) => item.code), ["USD", "GBP", "EUR"]);
  assert.deepEqual(result.unavailable, []);
  assert.equal(result.currencies[1].rateDate, "2026-11-16");
  assert.equal(dashboardMoney("125", result.currencies[1]), "\u00a3100.00");
  assert.equal(dashboardMoney("110", result.currencies[2]), "\u20ac100.00");
});
test("one failed quote leaves the other currency available", async () => {
  const result = await loadLiveDashboardRates(mockFetch((code) => code === "GBP" ? { rate: 0 } : {}), now);
  assert.deepEqual(result.unavailable, ["GBP"]);
  assert.deepEqual(result.currencies.map((item) => item.code), ["USD", "EUR"]);
});
test("rejects malformed, future and stale quotes without falling back to configured rates", async () => {
  for (const invalid of [{ rate: -1 }, { rate: "1.25" }, { quote: "EUR" }, { base: "JPY" },
    { date: "2026-11-17" }, { date: "2026-11-01" }, { date: "2026-02-30" }, { date: "bad" }]) {
    const result = await loadLiveDashboardRates(mockFetch(() => invalid), now);
    assert.deepEqual(result.currencies.map((item) => item.code), ["USD"]);
    assert.deepEqual(result.unavailable, ["GBP", "EUR"]);
  }
});
test("accepts the latest working-day rate across weekends", async () => {
  const result = await loadLiveDashboardRates(mockFetch(() => ({ date: "2026-11-13" })), now);
  assert.equal(result.currencies.length, 3);
});
test("timeouts, HTTP errors and invalid JSON keep the dashboard usable in USD", async () => {
  const fetchers: typeof fetch[] = [
    async () => { throw new Error("timeout"); },
    async () => new Response("unavailable", { status: 503 }),
    async () => new Response("not json"),
  ];
  for (const fetcher of fetchers) {
    const result = await loadLiveDashboardRates(fetcher, now);
    assert.deepEqual(result.currencies.map((item) => item.code), ["USD"]);
    assert.deepEqual(result.unavailable, ["GBP", "EUR"]);
  }
});
