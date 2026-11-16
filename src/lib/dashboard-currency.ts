export type DashboardCurrency = { code: string; symbol: string; usdPerUnit: string | null };

/** Divide the USD snapshot by USD per target unit; round once to cents. */
export function dashboardMoney(value: string | number | null | undefined, currency: DashboardCurrency): string {
  const amount = String(value ?? "");
  const rate = currency.usdPerUnit ?? "";
  if (!/^-?\d+(?:\.\d+)?$/.test(amount) || !/^\d+(?:\.\d+)?$/.test(rate)) return "\u2014";
  const [whole, fraction = ""] = amount.replace("-", "").split(".");
  const [rateWhole, rateFraction = ""] = rate.split(".");
  const divisor = BigInt(rateWhole + rateFraction);
  if (divisor === BigInt(0)) return "\u2014";
  const numerator = BigInt(whole + fraction) * BigInt(10) ** BigInt(rateFraction.length + 2);
  const denominator = divisor * BigInt(10) ** BigInt(fraction.length);
  const cents = (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
  const digits = cents.toString().padStart(3, "0");
  const grouped = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (amount.startsWith("-") && cents !== BigInt(0) ? "-" : "") + currency.symbol + grouped + "." + digits.slice(-2);
}
