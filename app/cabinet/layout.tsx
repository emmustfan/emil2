import { WorkspaceShell } from "@/components/workspace/shell";
export default function CabinetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
