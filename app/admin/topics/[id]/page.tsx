import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireEditor } from "@/lib/auth/server";
import { getTopic, listSections } from "@/lib/content/service";
import { contentPage } from "@/lib/content/page";
import { parseTopic } from "@/lib/content/parse";
import { getSetting } from "@/lib/settings";
import { SubjectImport } from "@/components/admin/subject-import";
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
  const siblings = await getDb().topic.findMany({
    where: { subjectId: topic.subjectId },
    select: { id: true, title: true, status: true },
    orderBy: [{ order: "asc" }, { id: "asc" }],
    take: 100,
  });
  return (
    <main>
      <div className="editor-page-heading">
        <h1 className="text-3xl font-semibold">{t.editTopic}</h1>
        <details className="inline-import">
          <summary>Импорт PDF/DOCX в этом предмете</summary>
          <div className="inline-import-body">
            <p className="text-sm emal-muted">
              Загрузите источник, чтобы создать новые черновики. Текущий урок
              сохраняется отдельно.
            </p>
            <SubjectImport
              actorId={user.id}
              subject={topic.subject}
              sections={sections}
              timeZone={user.timezone}
            />
          </div>
        </details>
      </div>
      <TopicEditor
        tree={
          <aside className="editor-tree" aria-label="Уроки предмета">
            <p>Содержание предмета</p>
            <Link
              className="editor-tree-subject"
              href={`/admin/subjects/${topic.subjectId}`}
            >
              {topic.subject.title}
            </Link>
            <nav aria-label="Другие уроки">
              {siblings.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/topics/${item.id}`}
                  aria-current={item.id === id ? "page" : undefined}
                >
                  <span>{item.title}</span>
                  <small>{t.statuses[item.status]}</small>
                </Link>
              ))}
            </nav>
            <Link
              className="editor-tree-add"
              href={`/admin/subjects/${topic.subjectId}/topics/new`}
            >
              + Создать урок
            </Link>
            <Link
              className="editor-tree-more"
              href={`/admin/subjects/${topic.subjectId}`}
            >
              Все уроки предмета →
            </Link>
          </aside>
        }
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
