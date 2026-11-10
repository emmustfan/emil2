import { WorkspaceShell } from "@/components/workspace/shell";
export async function LearningShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceShell area="learn">
      <main>{children}</main>
    </WorkspaceShell>
  );
}
