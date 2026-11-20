import Link from "next/link";
import { getCurrentSession } from "@/lib/auth/server";
import { contentPage } from "@/lib/content/page";
import { WorkspaceShell } from "@/components/workspace/shell";
import { dateTime, percent } from "@/lib/progress/display";
import { groupJournal, journalFilters } from "@/lib/progress/journal";
import { journalPath } from "@/lib/progress/routes";

export const metadata = {
  title: "Журнал группы",
  referrer: "same-origin" as const,
};

export default async function JournalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; subjectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id, subjectId }, search, session] = await Promise.all([
    params,
    searchParams,
    getCurrentSession(),
  ]);
  const filters = journalFilters(search);
  const actor = session && { id: session.user.id, readOnly: session.readOnly };
  const data = await contentPage(() =>
    groupJournal(actor, { groupId: id, subjectId }, filters),
  );
  const path = journalPath(id, subjectId);
  const query = new URLSearchParams();
  if (filters.sectionId) query.set("section", filters.sectionId);
  if (filters.lagging) query.set("lagging", "1");
  if (filters.removed) query.set("removed", "1");
  const sections: { title: string; id: string; count: number }[] = [];
  for (const topic of data.topics) {
    const id = topic.section?.id ?? "";
    const previous = sections.at(-1);
    if (previous?.id === id) previous.count++;
    else
      sections.push({
        title: topic.section?.title ?? "Без раздела",
        id,
        count: 1,
      });
  }

  return (
    <WorkspaceShell area="teacher">
      <main className="min-w-0 space-y-5">
        <Link href="/teacher/groups" className="underline">
          ← Группы и прогресс
        </Link>
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">
            Журнал группы {data.group.name}
          </h1>
          <p>{data.subject.title}</p>
          <Link href={path + "/analysis"} className="underline">
            Анализ заданий
          </Link>
        </header>
        <div className="flex flex-wrap items-end gap-4">
          <form action={path} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1">
              Раздел
              <select
                name="section"
                defaultValue={filters.sectionId ?? ""}
                className="min-h-11 max-w-full rounded-lg border bg-white px-3"
              >
                <option value="">Все разделы</option>
                {data.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                name="lagging"
                value="1"
                type="checkbox"
                defaultChecked={filters.lagging}
              />
              Только отстающие
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                name="removed"
                value="1"
                type="checkbox"
                defaultChecked={filters.removed}
              />
              Показать исключённых
            </label>
            <button className="lesson-primary">Показать</button>
          </form>
          <form
            method="post"
            action={`/api/teacher/groups/${id}/subjects/${subjectId}/export?${query}`}
          >
            <button
              className="emal-button emal-button-outline"
              disabled={!data.rows.length}
            >
              Скачать CSV
            </button>
          </form>
        </div>
        <p className="text-sm text-stone-600">
          Отстающие: завершено меньше {data.thresholds.minCompletionPercent}%
          тем предмета или нет активности больше {data.thresholds.inactiveDays}{" "}
          дн.
        </p>
        {!data.rows.length && <p>В журнале по этим фильтрам нет студентов.</p>}
        <div
          className="overflow-x-auto rounded-xl border border-stone-200 bg-white"
          tabIndex={0}
          role="region"
          aria-label="Таблица прогресса группы"
        >
          <table className="w-full text-left text-sm [&_td]:border [&_td]:border-stone-200 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-stone-200 [&_th]:px-3 [&_th]:py-2">
            <thead className="bg-stone-50">
              <tr>
                <th rowSpan={2} scope="col" className="min-w-40">
                  Студент
                </th>
                <th rowSpan={2} scope="col" className="min-w-48">
                  Итоги по предмету
                </th>
                {sections.map((section) => (
                  <th key={section.id} colSpan={section.count} scope="colgroup">
                    {section.title}
                  </th>
                ))}
              </tr>
              <tr>
                {data.topics.map((topic) => (
                  <th className="min-w-40" key={topic.id} scope="col">
                    {topic.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="align-top">
                    <Link
                      href={`${path}/students/${row.id}`}
                      prefetch={false}
                      className="underline"
                    >
                      {row.name}
                    </Link>
                    {row.removed && <p className="font-normal">Исключён</p>}
                    {row.lagging && (
                      <p className="font-normal text-amber-900">Отстающий</p>
                    )}
                  </th>
                  <td className="align-top">
                    {row.deleted ? (
                      "—"
                    ) : (
                      <>
                        <p>
                          Завершено {row.completed} из {row.total}
                        </p>
                        <p>Средний балл {percent(row.average)}</p>
                        <p>
                          К повторению {row.due} · просрочено {row.overdue}
                        </p>
                        <p>
                          Активность{" "}
                          {dateTime(row.lastActivity, session?.user.timezone)}
                        </p>
                      </>
                    )}
                  </td>
                  {row.cells.map((cell, i) => {
                    const topicId = data.topics[i].id;
                    if (row.deleted) return <td key={topicId}>—</td>;
                    if (cell.state === "Не начата" && !cell.videos.length)
                      return (
                        <td
                          key={topicId}
                          className="align-top bg-stone-50"
                          title="Нет учебной активности"
                        >
                          {cell.state}
                        </td>
                      );
                    const accuracy = percent(cell.accuracy);
                    const score = percent(cell.score);
                    return (
                      <td
                        key={topicId}
                        className={`align-top ${cell.completed ? "bg-emerald-50" : cell.state === "В процессе" ? "bg-amber-50" : "bg-stone-50"}`}
                        title={[
                          data.topics[i].title,
                          cell.state,
                          `Верные первые ответы: ${accuracy}`,
                          `Лучший тест: ${score}`,
                          ...cell.videos.map((v) => `${v.title}: ${v.method}`),
                        ].join("\n")}
                      >
                        <p className="font-medium">{cell.state}</p>
                        <p>
                          Пропуски {accuracy} · тест {score}
                        </p>
                        {cell.videos.map((v, index) => (
                          <p key={index}>Видео · {v.method}</p>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-stone-50">
              <tr>
                <th colSpan={2} scope="row">
                  Итоги по темам
                </th>
                {data.totals.map((total, i) => (
                  <td key={data.topics[i].id}>
                    <p>Завершили {percent(total.completion)}</p>
                    <p>Средний балл {percent(total.average)}</p>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </main>
    </WorkspaceShell>
  );
}
