import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuditLogViewer } from "@/components/audit-log-viewer";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditLogPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.permissions.includes("platform:admin")) redirect("/dashboard");

  return (
    <div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PLATFORM ADMINISTRATION</span>
          <h1>Audit log</h1>
          <p>Review a chronological record of account, workflow, and payment administration actions.</p>
        </div>
        <span className="profile-id"><span className="profile-id-dot" />RESTRICTED ACCESS</span>
      </div>
      <AuditLogViewer />
    </div>
  );
}
