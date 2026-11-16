import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PaymentRequestForm } from "@/components/payment-request-form";

export default async function EditPaymentRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user?.permissions.includes("payments:create")) redirect("/dashboard");
  const { id } = await params;
  return <PaymentRequestForm requestId={id} />;
}
