import { redirect } from "next/navigation";
import { APManagementDashboard } from "@/components/ap-management-dashboard";
import { getCurrentUser } from "@/lib/auth";

export default async function PayablesWorkspacePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.permissions.includes("ap:access")) redirect("/dashboard");
  return <APManagementDashboard />;
}
