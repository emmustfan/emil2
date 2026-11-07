import type { Metadata } from "next";
import { WorkspaceNav } from "@/components/workspace/nav";
import { StudentHome } from "@/components/student/home";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Моё обучение",
  robots: { index: false, follow: false },
};
export default function Student() {
  return (
    <>
      <WorkspaceNav />
      <StudentHome />
    </>
  );
}
