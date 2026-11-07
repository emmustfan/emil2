import { WorkspaceNav } from "@/components/workspace/nav";
export default async function CabinetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <WorkspaceNav />
      {children}
    </>
  );
}
