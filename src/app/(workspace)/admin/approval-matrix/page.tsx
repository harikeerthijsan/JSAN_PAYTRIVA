import { redirect } from "next/navigation";
import { ApprovalMatrix } from "@/components/approval-matrix";
import { getCurrentUser } from "@/lib/auth";

export default async function ApprovalMatrixPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.permissions.includes("payments:manage_masters")) redirect("/dashboard");
  return <ApprovalMatrix />;
}
