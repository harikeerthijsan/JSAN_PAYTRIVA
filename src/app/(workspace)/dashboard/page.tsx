import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { FinancialOverview } from "@/components/financial-overview";

import { loadCurrencyRates } from "@/lib/currency";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const currencies = await loadCurrencyRates();
  return (
    <FinancialOverview fullName={user.fullName} permissions={user.permissions} currencies={currencies} />
  );
}
