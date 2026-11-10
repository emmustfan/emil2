import { requireEditor } from "@/lib/auth/server";
import { WorkspaceShell } from "@/components/workspace/shell";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireEditor();
  return (
    <WorkspaceShell area={user.role === "ADMIN" ? "admin" : "teacher"}>
      {children}
    </WorkspaceShell>
  );
}
