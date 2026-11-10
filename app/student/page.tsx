import type { Metadata } from "next";
import { WorkspaceShell } from "@/components/workspace/shell";
import { StudentHome } from "@/components/student/home";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Моё обучение",
  robots: { index: false, follow: false },
};
export default function Student() {
  return (
    <WorkspaceShell>
      <StudentHome />
    </WorkspaceShell>
  );
}
