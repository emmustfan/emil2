import type { ReactNode } from "react";
import { getCurrentSession } from "@/lib/auth/server";
import { ReviewLink } from "@/components/review/link";
import { WorkspaceFrame } from "./sidebar";
export async function WorkspaceShell({
  children,
  area = "student",
}: {
  children: ReactNode;
  area?: "admin" | "teacher" | "student" | "learn";
}) {
  const session = await getCurrentSession();
  return (
    <WorkspaceFrame
      role={session?.user.role}
      name={session?.user.name}
      area={area}
      review={session ? <ReviewLink /> : null}
    >
      {children}
    </WorkspaceFrame>
  );
}
