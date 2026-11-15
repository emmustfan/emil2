import Link from "next/link";
import { getCurrentSession } from "@/lib/auth/server";
import { contentPage } from "@/lib/content/page";
import { progressSummary } from "@/lib/progress/summary";
import { progressFilters } from "@/lib/progress/policy";
import { assertCanViewStudent } from "@/lib/progress/access";
import { Pagination } from "@/components/admin/pagination";
export const dynamic = "force-dynamic";
const columns = {
  name: "Студент",
  subjects: "Предметы с активностью",
  completed: "Завершено тем",
  average: "Средний балл",
  due: "К повторению",
  overdue: "Просрочено",
  lastActivity: "Последняя активность",
} as const;
export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = (await getCurrentSession())?.user;
  await contentPage(() => assertCanViewStudent(viewer?.id));
  const query = progressFilters.safeParse(await searchParams),
    filters = query.success ? query.data : progressFilters.parse({});
  const data = await contentPage(() =>
    progressSummary({ ...filters, viewerId: viewer?.id }),
  );
  return (
    <main>
      <h1 className="text-3xl font-semibold">Прогресс студентов</h1>
      <p className="mt-4 text-sm text-stone-600">
        Отстающие: завершено меньше {data.settings.minCompletionPercent}% тем по
        предметам с активностью или нет активности больше{" "}
        {data.settings.inactiveDays} дней. Пороги меняются в настройках.
      </p>
      <form role="search" className="my-6 flex flex-wrap gap-3">
        <input
          aria-label="Имя или email студента"
          name="q"
          defaultValue={filters.q}
          placeholder="Имя или email студента"
          className="min-h-11 min-w-0 flex-1 rounded border px-3"
          maxLength={200}
        />
        <select
          aria-label="Фильтр прогресса"
          name="filter"
          defaultValue={filters.filter}
          className="min-h-11 rounded border bg-white px-3"
        >
          <option value="all">Все студенты</option>
          <option value="lagging">Отстающие</option>
        </select>
        <input type="hidden" name="sort" value={filters.sort} />
        <input type="hidden" name="direction" value={filters.direction} />
        <button className="lesson-primary">Показать</button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead>
            <tr>
              {Object.entries(columns).map(([key, label]) => (
                <th
                  key={key}
                  className="p-4"
                  aria-sort={
                    filters.sort === key
                      ? filters.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <Link
                    href={`/admin/progress?${new URLSearchParams({ ...filters, page: "1", sort: key, direction: filters.sort === key && filters.direction === "asc" ? "desc" : "asc" })}`}
                  >
                    {label}{" "}
                    {filters.sort === key
                      ? filters.direction === "asc"
                        ? "↑"
                        : "↓"
                      : "↕"}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-4">
                  <Link
                    prefetch={false}
                    href={`/admin/users/${row.id}/progress`}
                    className="font-medium text-emerald-900 underline"
                  >
                    {row.name}
                  </Link>
                  <p className="mt-1 text-xs text-stone-500">{row.email}</p>
                </td>
                <td className="p-4">{row.subjects || "Пока нет"}</td>
                <td className="p-4">
                  {row.completed} / {row.totalTopics}
                </td>
                <td className="p-4">
                  {row.average === null
                    ? "—"
                    : `${Math.round(row.average * 100)}%`}
                </td>
                <td className="p-4">{row.due}</td>
                <td className="p-4">{row.overdue}</td>
                <td className="p-4">
                  {row.lastActivity
                    ? new Date(row.lastActivity).toLocaleString("ru-RU", {
                        timeZone: viewer?.timezone,
                      })
                    : "Пока нет"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.items.length && <p className="my-6">Студенты не найдены.</p>}
      <Pagination
        base="/admin/progress"
        {...data}
        q={filters.q}
        filters={{
          filter: filters.filter,
          sort: filters.sort,
          direction: filters.direction,
        }}
      />
    </main>
  );
}
