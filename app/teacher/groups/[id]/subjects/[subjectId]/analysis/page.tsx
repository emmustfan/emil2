import Link from "next/link";
import { getCurrentSession } from "@/lib/auth/server";
import { contentPage } from "@/lib/content/page";
import { WorkspaceShell } from "@/components/workspace/shell";
import { groupAnalysis } from "@/lib/progress/analysis";
import { percent } from "@/lib/progress/display";
import { journalPath } from "@/lib/progress/routes";

export const metadata = {
  title: "Анализ заданий",
  referrer: "no-referrer" as const,
};
const kind = {
  gap: "Пропуск",
  question: "Вопрос теста",
  video: "Вопрос видео",
};

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string; subjectId: string }>;
}) {
  const [{ id, subjectId }, session] = await Promise.all([
    params,
    getCurrentSession(),
  ]);
  const actor = session && { id: session.user.id, readOnly: session.readOnly };
  const data = await contentPage(() =>
    groupAnalysis(actor, { groupId: id, subjectId }),
  );
  return (
    <WorkspaceShell area="teacher">
      <main className="mx-auto max-w-5xl space-y-5">
        <Link href={journalPath(id, subjectId)} className="underline">
          ← Журнал группы
        </Link>
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Анализ заданий</h1>
          <p>
            {data.group.name} · {data.subject.title}
          </p>
        </header>
        {!data.items.length && <p>Опубликованных заданий пока нет.</p>}
        {data.items.map((item) => (
          <article
            className="emal-panel space-y-2"
            key={`${item.kind}:${item.id}`}
          >
            <p className="text-sm">
              {item.topicTitle} · {kind[item.kind]}
            </p>
            <h2 className="text-lg font-semibold">{item.stem}</h2>
            <p>
              Ответили {item.total} · верных первых ответов{" "}
              {percent(item.accuracy)}
            </p>
            {item.wrong.length > 0 && (
              <>
                <h3 className="font-medium">Частые неверные ответы</h3>
                <ul className="list-inside list-disc break-words">
                  {item.wrong.map(({ text, count }) => (
                    <li key={text}>
                      {text} · {count}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {data.canEdit && (
              <Link
                className="underline"
                href={`/admin/topics/${item.topicId}#${item.kind === "gap" ? "lesson-text" : `lesson-question-${item.id}`}`}
              >
                Открыть в редакторе
              </Link>
            )}
          </article>
        ))}
      </main>
    </WorkspaceShell>
  );
}
