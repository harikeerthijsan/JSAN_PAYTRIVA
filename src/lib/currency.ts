import "server-only";
import { db } from "@/lib/db";

export type CurrencyRate = { code: string; name: string; symbol: string; usdPerUnit: string | null };

/**
 * Active currencies with their latest USD-per-unit rate (USD is the 1:1 base). Currencies
 * without a configured exchange rate return a null rate and cannot be used for display
 * conversion. Shared by every dashboard/summary that offers a display-currency switcher.
 */
export async function loadCurrencyRates(): Promise<CurrencyRate[]> {
  const [currencyRows, rateRows] = await Promise.all([
    db.paymentCurrency.findMany({ where: { isActive: true }, select: { code: true, name: true, symbol: true }, orderBy: { code: "asc" } }),
    db.currencyExchangeRate.findMany({ where: { effectiveAt: { lte: new Date() } }, orderBy: { effectiveAt: "desc" }, select: { currencyCode: true, usdPerUnit: true } }),
  ]);
  const latestRate = new Map<string, string>();
  for (const rate of rateRows) if (!latestRate.has(rate.currencyCode)) latestRate.set(rate.currencyCode, rate.usdPerUnit.toString());
  return currencyRows.map((currency) => ({
    code: currency.code,
    name: currency.name,
    symbol: currency.symbol,
    usdPerUnit: currency.code === "USD" ? "1" : latestRate.get(currency.code) ?? null,
  }));
}
