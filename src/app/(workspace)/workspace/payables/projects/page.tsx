import { redirect } from "next/navigation";
import { APProjectPayments } from "@/components/ap-project-payments";
import { getCurrentUser } from "@/lib/auth";

export default async function PayablesProjectsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.permissions.includes("ap:access")) redirect("/dashboard");
  return <APProjectPayments />;
}
