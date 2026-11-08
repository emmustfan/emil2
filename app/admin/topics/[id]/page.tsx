import { requireEditor } from "@/lib/auth/server";
import { getTopic, listSections } from "@/lib/content/service";
import { contentPage } from "@/lib/content/page";
import { parseTopic } from "@/lib/content/parse";
import { getSetting } from "@/lib/settings";
import { TopicEditor } from "@/components/admin/topic-editor";
import { contentRu as t } from "@/lib/i18n/ru";
export default async function TopicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireEditor();
  const { id } = await params;
  const topic = await contentPage(() => getTopic(id, undefined, user.id));
  const sections = await listSections(topic.subjectId, user.id);
  return (
    <main>
      <h1 className="mb-7 text-3xl font-semibold">{t.editTopic}</h1>
      <TopicEditor
        key={topic.id}
        initial={topic}
        initialParsed={parseTopic(topic.contentMd)}
        sections={sections}
        autosaveMs={await getSetting("content.autosaveMs")}
        minQuestions={await getSetting("content.minQuestions")}
        maxQuestions={await getSetting("content.maxQuestions")}
        imageMaxBytes={await getSetting("content.imageMaxBytes")}
      />
    </main>
  );
}
