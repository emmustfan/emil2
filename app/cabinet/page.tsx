import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { workspaceHref } from "@/lib/auth/roles";
import { StudentHome } from "@/components/student/home";
export default async function Cabinet() {
  const user = await requireUser();
  if (user.role !== "USER") redirect(workspaceHref(user.role));
  return <StudentHome />;
}
