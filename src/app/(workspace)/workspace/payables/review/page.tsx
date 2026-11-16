import { redirect } from "next/navigation";
import { APReviewQueue } from "@/components/ap-review-queue";
import { getCurrentUser } from "@/lib/auth";

export default async function PayablesReviewPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.permissions.includes("ap:access")) redirect("/dashboard");
  const { status } = await searchParams;
  const allowedStatuses = ["PENDING_REVIEW", "UNDER_REVIEW", "RETURNED", "NEEDS_INFORMATION"];
  return <APReviewQueue initialStatus={status && allowedStatuses.includes(status) ? status : ""} />;
}
