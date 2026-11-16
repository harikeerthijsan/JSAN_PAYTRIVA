import { notFound, redirect } from "next/navigation";
import { NotificationSettingsPanel } from "@/components/notification-settings-panel";
import { getCurrentUser } from "@/lib/auth";

export default async function NotificationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.permissions.includes("platform:admin")) notFound();
  return <NotificationSettingsPanel timeZone={user.timeZone} />;
}
