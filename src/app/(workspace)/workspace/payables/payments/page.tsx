import { redirect } from "next/navigation";
import { APPaymentQueue } from "@/components/ap-payment-queue";
import { getCurrentUser } from "@/lib/auth";

export default async function PayablesPaymentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.permissions.includes("ap:access")) redirect("/dashboard");
  return <APPaymentQueue />;
}
