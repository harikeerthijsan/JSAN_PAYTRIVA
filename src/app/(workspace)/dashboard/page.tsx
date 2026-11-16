import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { FinancialOverview } from "@/components/financial-overview";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <FinancialOverview fullName={user.fullName} permissions={user.permissions} />
  );
}
