import { redirect } from "next/navigation";
import { PaymentCalendarView } from "@/components/payment-calendar-view";
import { getCurrentUser } from "@/lib/auth";

export default async function PaymentCalendarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const canView = ["payments:read_own", "payments:read_all", "approvals:access", "payments:create"].some((permission) =>
    user.permissions.includes(permission),
  );
  if (!canView) redirect("/dashboard");
  return <PaymentCalendarView canManage={user.permissions.includes("ap:access")} />;
}
