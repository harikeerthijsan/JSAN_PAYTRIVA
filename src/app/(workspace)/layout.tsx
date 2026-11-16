import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getCurrentUser } from "@/lib/auth";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return <WorkspaceShell user={user}>{children}</WorkspaceShell>;
}
