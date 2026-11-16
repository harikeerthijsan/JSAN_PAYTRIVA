import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PaymentRequestDetails } from "@/components/payment-request-details";

export default async function PaymentRequestDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.permissions.includes("payments:read_own") && !user.permissions.includes("payments:read_all") && !user.permissions.includes("approvals:access") && !user.permissions.includes("platform:admin")) notFound();
  const { id } = await params;
  return (
    <PaymentRequestDetails
      id={id}
      currentUserId={user.id}
      canEdit={user.permissions.includes("payments:create")}
      canReview={user.permissions.includes("ap:access")}
      canApprove={user.permissions.includes("approvals:access")}
      canCorrectPayment={user.permissions.includes("ap:access") && user.permissions.includes("payments:correct")}
    />
  );
}
