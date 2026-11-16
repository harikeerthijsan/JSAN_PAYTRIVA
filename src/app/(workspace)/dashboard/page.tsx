import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { FinancialOverview } from "@/components/financial-overview";

import { loadLiveDashboardRates } from "@/lib/live-dashboard-rates";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const exchangeRates = await loadLiveDashboardRates();
  return (
    <FinancialOverview fullName={user.fullName} permissions={user.permissions} exchangeRates={exchangeRates} />
  );
}
