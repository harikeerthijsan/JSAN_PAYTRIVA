import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UsersManager } from "@/components/users-manager";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "User management" };

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.permissions.includes("users:read")) redirect("/dashboard");
  return (
    <div>
      <div className="page-heading">
        <div><span className="eyebrow">ACCESS ADMINISTRATION</span><h1>User management</h1><p>Manage employee accounts, invitations, and role assignments.</p></div>
        <span className="directory-count"><strong>JSAN</strong> TEAM DIRECTORY</span>
      </div>
      <UsersManager />
    </div>
  );
}
