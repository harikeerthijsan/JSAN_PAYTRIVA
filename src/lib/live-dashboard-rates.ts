import type { DashboardCurrency } from "./dashboard-currency";

export type LiveDashboardRate = DashboardCurrency & { name: string; rateDate: string | null };
export type LiveDashboardRates = {
  currencies: LiveDashboardRate[];
  unavailable: string[];
  source: "Frankfurter";
};

const targets = [
  { code: "GBP", name: "British Pound", symbol: "\u00a3" },
  { code: "EUR", name: "Euro", symbol: "\u20ac" },
];

/** Daily reference rates, checked hourly. Never reads or falls back to master data. */
export async function loadLiveDashboardRates(fetcher: typeof fetch = fetch, now = new Date()): Promise<LiveDashboardRates> {
  const results = await Promise.all(targets.map(async (currency): Promise<LiveDashboardRate | null> => {
    try {
      const response = await fetcher("https://api.frankfurter.dev/v2/rate/" + currency.code.toLowerCase() + "/usd", {
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      const row: unknown = await response.json();
      if (!row || typeof row !== "object") return null;
      const { base, quote, rate, date } = row as Record<string, unknown>;
      if (base !== currency.code || quote !== "USD" || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 ||
          typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const published = new Date(date + "T00:00:00Z");
      // Allow weekends/holidays, but never silently display indefinitely stale or future rates.
      const age = now.getTime() - published.getTime();
      if (!Number.isFinite(age) || published.toISOString().slice(0, 10) !== date || age < 0 || age > 7 * 86400000) return null;
      const usdPerUnit = rate.toString();
      if (!/^\d+(?:\.\d+)?$/.test(usdPerUnit)) return null;
      return { ...currency, usdPerUnit, rateDate: date };
    } catch {
      return null;
    }
  }));
  return {
    source: "Frankfurter",
    currencies: [
      { code: "USD", name: "US Dollar", symbol: "$", usdPerUnit: "1", rateDate: null },
      ...results.filter((rate): rate is LiveDashboardRate => rate !== null),
    ],
    unavailable: targets.filter((_, index) => results[index] === null).map((currency) => currency.code),
  };
}
