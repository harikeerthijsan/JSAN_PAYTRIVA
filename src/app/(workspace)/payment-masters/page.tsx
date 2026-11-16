import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PaymentMasters } from "@/components/payment-masters";

export default async function PaymentMastersPage() {
  const user = await getCurrentUser();
  if (!user?.permissions.includes("payments:manage_masters")) redirect("/dashboard");
  return <PaymentMasters />;
}
