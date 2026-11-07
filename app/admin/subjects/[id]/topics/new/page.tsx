import { requireEditor } from "@/lib/auth/server";
import { getSubject, listSections } from "@/lib/content/service";
import { contentPage } from "@/lib/content/page";
import { NewTopicForm } from "@/components/admin/new-topic-form";
import { contentRu as t } from "@/lib/i18n/ru";
export default async function NewTopic({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireEditor();
  const { id } = await params;
  const subject = await contentPage(() => getSubject(id, user.id));
  const sections = await listSections(id, user.id);
  return (
    <main className="mx-auto max-w-3xl">
      <h1 className="mb-3 text-3xl font-semibold">{t.newTopic}</h1>
      <p className="mb-7 text-sm text-stone-600">{subject.title}</p>
      <div className="rounded-2xl border border-stone-200 bg-white p-6">
        <NewTopicForm subjectId={id} sections={sections} />
      </div>
    </main>
  );
}
