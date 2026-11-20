import { can } from "@/lib/org";
import { ContentTree } from "@/components/admin/content-tree";
import Link from "next/link";
import { requireEditor } from "@/lib/auth/server";
import { getSubject, listSections, subjectDTO } from "@/lib/content/service";
import { contentPage } from "@/lib/content/page";
import { contentRu as t } from "@/lib/i18n/ru";
import { SubjectForm } from "@/components/admin/subject-form";
import { SectionForm } from "@/components/admin/section-form";
import { SubjectArchiveButton } from "@/components/admin/subject-archive-button";
import { getDb } from "@/lib/db";
export default async function SubjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireEditor();
  const { id } = await params;
  const subject = await contentPage(() => getSubject(id, user));
  const manage = await can(user, "subject.manage", { subjectId: id });
  const archive = (
    <SubjectArchiveButton
      id={id}
      revision={subject.editRevision}
      archived={!!subject.archivedAt}
      returnTo={user.role === "ADMIN" ? "/admin" : "/admin/subjects/archive"}
    />
  );
  if (subject.archivedAt)
    return (
      <main className="space-y-5">
        <Link className="underline" href="/admin/subjects/archive">
          К архиву предметов
        </Link>
        <h1 className="text-3xl font-semibold">{subject.title}</h1>
        <p>
          Предмет в архиве. Восстановление вернёт его в список предметов как
          черновик.
        </p>
        {manage && archive}
      </main>
    );

  const sections = await listSections(id, user);
  const edit = await can(user, "content.edit", { subjectId: id });
  const archivedTopics = await getDb().topic.findMany({
    where: { subjectId: id, archivedAt: { not: null } },
    orderBy: [{ archivedAt: "desc" }, { id: "asc" }],
    select: { id: true, draftTitle: true },
  });
  return (
    <main className="space-y-8">
      <h1 className="text-3xl font-semibold">{subject.title}</h1>
      <div className="flex flex-wrap items-start gap-3">
        <Link className="lesson-primary" href={`/admin/subjects/${id}/editor`}>
          Открыть книгу и редактор уроков →
        </Link>
        {manage && archive}
      </div>
      <ContentTree subjects={[subject]} canManageSubjects={manage} />
      {archivedTopics.length > 0 && (
        <details className="emal-panel" id="archived-lessons">
          <summary>Архив уроков ({archivedTopics.length})</summary>
          <ul className="mt-4 space-y-2">
            {archivedTopics.map((topic) => (
              <li key={topic.id}>
                <Link className="underline" href={`/admin/topics/${topic.id}`}>
                  {topic.draftTitle}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
      {manage && (
        <details
          id="subject-settings"
          className="rounded-2xl border border-stone-200 bg-white p-6"
        >
          <summary className="min-h-11 cursor-pointer text-lg font-semibold">
            {t.editSubject}
          </summary>
          <div className="mt-6">
            <SubjectForm
              key={`${subject.id}-${subject.editRevision}`}
              initial={subjectDTO(subject)}
            />
          </div>
        </details>
      )}
      {edit && (
        <details className="emal-panel">
          <summary>Настройки разделов: названия и порядок</summary>
          <div className="space-y-4">
            {sections.map((s) => (
              <SectionForm
                key={`${s.id}-${s.editRevision}`}
                subjectId={id}
                initial={s}
              />
            ))}
            <SectionForm subjectId={id} />
          </div>
        </details>
      )}
    </main>
  );
}
