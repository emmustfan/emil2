import Link from "next/link";
import { requireEditor } from "@/lib/auth/server";
import { WorkspaceShell } from "@/components/workspace/shell";
import {
  GroupCreateForm,
  GroupImportForm,
} from "@/components/groups/directory-forms";
import { groupDirectory } from "@/lib/org/groups";
import { academicYear } from "@/lib/groups/input";

export const metadata = { title: "Учебные группы" };

export default async function GroupDirectoryPage() {
  const actor = await requireEditor();
  const { groups, faculties } = await groupDirectory(actor);
  return (
    <WorkspaceShell area="teacher">
      <main className="mx-auto max-w-5xl space-y-7">
        <h1 className="text-3xl font-semibold">Учебные группы</h1>
        {faculties.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            <GroupCreateForm
              faculties={faculties}
              year={academicYear(new Date())}
            />
            <GroupImportForm faculties={faculties} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <article key={group.id} className="emal-panel space-y-2">
              <h2>
                <Link
                  href={`/teacher/groups/${group.id}`}
                  className="text-lg font-semibold underline"
                >
                  {group.name}
                </Link>
              </h2>
              <p className="text-sm">
                {group.faculty.title} · {group.course} курс ·{" "}
                {group.academicYear}
              </p>
              {group.archivedAt && <p>Архивная группа</p>}
            </article>
          ))}
          {!groups.length && <p>Нет доступных учебных групп.</p>}
        </div>
      </main>
    </WorkspaceShell>
  );
}
