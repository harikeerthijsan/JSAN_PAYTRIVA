import { redirect } from "next/navigation";
import { ManagementDashboard } from "@/components/management-dashboard";
import { getCurrentUser } from "@/lib/auth";

export default async function ManagementPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.permissions.includes("reports:access")) redirect("/dashboard");
  return <ManagementDashboard userName={user.fullName} />;
}
