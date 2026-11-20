import Link from "next/link";
import { requireEditor } from "@/lib/auth/server";
import { WorkspaceShell } from "@/components/workspace/shell";
import {
  GroupCreateForm,
  GroupImportForm,
} from "@/components/groups/directory-forms";
import { directoryProgress } from "@/lib/progress/journal";
import { journalPath } from "@/lib/progress/routes";
import { percent } from "@/lib/progress/display";
import { academicYear } from "@/lib/groups/input";

export const metadata = { title: "Учебные группы" };

export default async function GroupDirectoryPage() {
  const actor = await requireEditor();
  const { groups, managementGroups, faculties } =
    await directoryProgress(actor);
  return (
    <WorkspaceShell area="teacher">
      <main className="mx-auto max-w-5xl space-y-7">
        <h1 className="text-3xl font-semibold">Группы и прогресс</h1>
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
              <h2 className="text-lg font-semibold">
                {group.hasGroupPage ? (
                  <Link
                    href={`/teacher/groups/${group.id}`}
                    className="underline"
                  >
                    {group.name}
                  </Link>
                ) : (
                  group.name
                )}
              </h2>
              <p className="text-sm">
                {group.faculty.title} · {group.course} курс ·{" "}
                {group.academicYear}
              </p>
              <p className="text-sm">
                Студентов {group.active} · заявок {group.pending}
              </p>
              {group.archivedAt && <p>Архивная группа</p>}
              {group.subjects.length > 0 && (
                <ul className="space-y-1">
                  {group.subjects.map((subject) => (
                    <li key={subject.id}>
                      <Link
                        href={journalPath(group.id, subject.id)}
                        className="underline"
                      >
                        Журнал · {subject.title}
                      </Link>
                      <span className="text-sm">
                        {" "}
                        · завершено в среднем {percent(subject.rate)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
          {!groups.length && <p>Нет групп с доступным журналом.</p>}
        </div>
        {managementGroups.length > 0 && (
          <section className="emal-panel space-y-3">
            <h2 className="text-lg font-semibold">
              Управление предметами других групп
            </h2>
            <ul className="space-y-2">
              {managementGroups.map((group) => (
                <li key={group.id}>
                  <Link
                    className="underline"
                    href={`/teacher/groups/${group.id}`}
                  >
                    {group.name}
                  </Link>
                  <span className="text-sm">
                    {" "}
                    · {group.faculty.title} · {group.academicYear}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </WorkspaceShell>
  );
}
