import type { Metadata } from "next";
import { ProfileForm } from "@/components/profile-form";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <div>
      <div className="page-heading">
        <div><span className="eyebrow">YOUR ACCOUNT</span><h1>My profile</h1><p>Review and update your personal account details.</p></div>
        <span className="profile-id"><span className="profile-id-dot" />ACCOUNT PROFILE</span>
      </div>
      <ProfileForm fullName={user.fullName} email={user.email} role={user.roles[0]?.name ?? "Team member"} timeZone={user.timeZone} />
    </div>
  );
}
