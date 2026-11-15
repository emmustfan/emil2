import { requireEditor } from "@/lib/auth/server";
import { getSubject, listSections } from "@/lib/content/service";
import { contentPage } from "@/lib/content/page";
import { SubjectImport } from "@/components/admin/subject-import";
import { LessonCreation } from "@/components/admin/lesson-creation";
import { NewTopicForm } from "@/components/admin/new-topic-form";
import { contentRu as t } from "@/lib/i18n/ru";
export default async function NewTopic({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireEditor();
  const { id } = await params;
  const subject = await contentPage(() => getSubject(id, user));
  const sections = await listSections(id, user);
  return (
    <main className="lesson-creation">
      <h1 className="mb-3 text-3xl font-semibold">{t.newTopic}</h1>
      <p className="mb-7 text-sm text-stone-600">{subject.title}</p>
      <LessonCreation
        manual={<NewTopicForm subjectId={id} sections={sections} />}
        upload={
          <SubjectImport
            actor={user}
            subject={subject}
            sections={sections}
            timeZone={user.timezone}
          />
        }
      />
    </main>
  );
}
