import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PaymentRequestForm } from "@/components/payment-request-form";

export default async function NewPaymentRequestPage() {
  const user = await getCurrentUser();
  if (!user?.permissions.includes("payments:create")) redirect("/dashboard");
  return <PaymentRequestForm />;
}
