"use client";

import { Coins } from "lucide-react";

export type CurrencyOption = { code: string; name?: string; symbol: string; usdPerUnit: string | null };

/** Format a USD value into the chosen display currency at its latest rate (usdPerUnit = USD per 1 unit). */
export function convertFromUsd(value: string | number | null | undefined, currency: { symbol: string; usdPerUnit: string | null }): string {
  if (value === null || value === undefined || value === "") return "—";
  const rate = Number(currency.usdPerUnit || "1") || 1;
  return `${currency.symbol}${(Number(value) / rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const USD_FALLBACK: CurrencyOption = { code: "USD", name: "US Dollar", symbol: "$", usdPerUnit: "1" };

export function resolveCurrency(currencies: CurrencyOption[], code: string): CurrencyOption {
  return currencies.find((currency) => currency.code === code && currency.usdPerUnit !== null) ?? USD_FALLBACK;
}

/** A clearly-labelled control to choose the currency figures are displayed in. */
export function CurrencySwitcher({ currencies, value, onChange }: {
  currencies: CurrencyOption[];
  value: string;
  onChange: (code: string) => void;
}) {
  const options = currencies.filter((currency) => currency.usdPerUnit !== null);
  const list = options.length ? options : [USD_FALLBACK];
  return (
    <label className="currency-switcher" title="Choose the currency to display amounts in">
      <Coins size={15} aria-hidden="true" />
      <span className="currency-switcher-label">Currency</span>
      <select aria-label="Display currency" value={value} onChange={(event) => onChange(event.target.value)}>
        {list.map((currency) => (
          <option key={currency.code} value={currency.code}>{currency.code} ({currency.symbol})</option>
        ))}
      </select>
    </label>
  );
}
