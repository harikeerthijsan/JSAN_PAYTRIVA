import { notFound, redirect } from "next/navigation";
import { PaymentConfirmationForm } from "@/components/payment-confirmation-form";
import { getCurrentUser } from "@/lib/auth";

export default async function PaymentConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.permissions.includes("ap:access")) notFound();
  const { id } = await params;
  return <PaymentConfirmationForm id={id} />;
}
