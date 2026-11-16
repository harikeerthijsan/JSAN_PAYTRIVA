import { redirect } from "next/navigation";
import { APPaymentCalendar } from "@/components/ap-payment-calendar";
import { getCurrentUser } from "@/lib/auth";

export default async function PayablesCalendarPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.permissions.includes("ap:access")) redirect("/dashboard");
  const { view } = await searchParams;
  const allowedViews = ["all", "upcoming", "week", "overdue", "wednesday", "completed"];
  return <APPaymentCalendar initialView={view && allowedViews.includes(view) ? view : "all"} />;
}
