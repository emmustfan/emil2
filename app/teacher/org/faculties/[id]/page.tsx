import { requireEditor } from "@/lib/auth/server";
import { FacultyManager } from "@/components/admin/org-page";
import { WorkspaceShell } from "@/components/workspace/shell";
import { contentPage } from "@/lib/content/page";
import { assertCan } from "@/lib/org";

export default async function FacultyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireEditor(),
    { id } = await params;
  await contentPage(() =>
    assertCan(actor, "faculty.manage", { facultyId: id }),
  );
  return (
    <WorkspaceShell area="teacher">
      <FacultyManager facultyId={id} admin={false} />
    </WorkspaceShell>
  );
}
