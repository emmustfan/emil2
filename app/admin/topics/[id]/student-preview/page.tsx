import Link from "next/link";
import { requireEditor } from "@/lib/auth/server";
import { getTopic } from "@/lib/content/service";
import { contentPage } from "@/lib/content/page";
import { parseTopic } from "@/lib/content/parse";
import { MarkdownPreview } from "@/components/content/markdown-preview";
import { AnswerPreview } from "@/components/exercises/preview";
import { SafeMarkdown } from "@/components/lessons/markdown";
export const dynamic = "force-dynamic";
export default async function StudentPreview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireEditor(),
    { id } = await params;
  const topic = await contentPage(() => getTopic(id, undefined, user.id));
  return (
    <main className="student-lesson-preview">
      <div className="student-preview-banner">
        <div>
          <strong>
            Предпросмотр ученика ·{" "}
            {topic.status === "PUBLISHED" ? "опубликованный урок" : "черновик"}
          </strong>
          <p>
            Задания можно проверять. Ответы не сохраняются в прогресс. Этот
            просмотр доступен только автору и администратору.
          </p>
        </div>
        <Link className="lesson-primary" href={`/admin/topics/${id}`}>
          Вернуться в редактор
        </Link>
      </div>
      <p className="book-breadcrumb">{topic.subject.title} / Урок</p>
      <h1>{topic.title}</h1>
      {topic.needsExpertReview && (
        <p className="student-preview-review">
          Демонстрационный материал. Медицинское содержание ещё не подтверждено
          экспертом.
        </p>
      )}
      <p className="emal-muted">
        {topic.readingMinutes ? `${topic.readingMinutes} минут чтения · ` : ""}
        {topic.isFree ? "Бесплатный урок" : "По доступу к предмету"}
      </p>
      <article className="emal-panel student-preview-material">
        <MarkdownPreview
          markdown={topic.contentMd}
          parsed={parseTopic(topic.contentMd)}
          exercises={topic.gapExercises}
        />
      </article>
      <section className="emal-panel student-preview-test">
        <h2>Тест по теме</h2>
        <p>Ответьте на вопросы после чтения методички.</p>
        {topic.questions.map((q, i) => (
          <article key={q.id}>
            <AnswerPreview
              id={`student-preview-${q.id}`}
              title={`${i + 1}. ${q.stem}`}
              definition={{
                answerType: q.answerType,
                options: q.options,
                correctOptionIds: q.correctOptionIds,
                acceptedAnswers: q.acceptedAnswers,
                explanation: q.explanation,
              }}
            />
          </article>
        ))}
      </section>
      {topic.referencesMd && (
        <section className="emal-panel">
          <h2>Источники</h2>
          <SafeMarkdown markdown={topic.referencesMd} />
        </section>
      )}
    </main>
  );
}
