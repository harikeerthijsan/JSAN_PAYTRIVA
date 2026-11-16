import { redirect } from "next/navigation";
import { ApprovalDashboard } from "@/components/approval-dashboard";
import { getCurrentUser } from "@/lib/auth";

export default async function ApprovalWorkspacePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.permissions.includes("approvals:access")) redirect("/dashboard");
  return <ApprovalDashboard />;
}
