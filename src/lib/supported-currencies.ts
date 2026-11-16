export const SUPPORTED_CURRENCY_CODES = ["EUR", "GBP", "USD"] as const;
export const SUPPORTED_CURRENCIES = [
  { code: "EUR", name: "Euro", symbol: "\u20ac", decimalPlaces: 2, isActive: true },
  { code: "GBP", name: "British Pound", symbol: "\u00a3", decimalPlaces: 2, isActive: true },
  { code: "USD", name: "US Dollar", symbol: "$", decimalPlaces: 2, isActive: true },
];
