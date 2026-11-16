import { NotificationCenter } from "@/components/notification-center";
import { getCurrentUser } from "@/lib/auth";

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <NotificationCenter timeZone={user.timeZone} />;
}
