import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PaymentRequestList } from "@/components/payment-request-list";

export default async function PaymentRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ search?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user || (!user.permissions.includes("payments:read_own") && !user.permissions.includes("payments:read_all"))) redirect("/dashboard");
  const params = await searchParams;
  const initialSearch = typeof params?.search === "string" ? params.search.slice(0, 100) : "";
  return <PaymentRequestList initialSearch={initialSearch} canCreate={user.permissions.includes("payments:create")} canReadAll={user.permissions.includes("payments:read_all")} />;
}
