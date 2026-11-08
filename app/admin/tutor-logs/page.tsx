import { spendSummary } from "@/lib/monitoring/usage";
import Link from "next/link";
import { requireEditor } from "@/lib/auth/server";
import { tutorLogs } from "@/lib/admin/tutor-logs";
import { ReportFilters } from "@/components/admin/report-filters";
import { ContentError } from "@/lib/content/errors";
import { ZodError } from "zod";
export const dynamic = "force-dynamic";
export default async function TutorLogs({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    subjectId?: string;
    inaccurate?: string;
    page?: string;
  }>;
}) {
  const actor = await requireEditor(),
    raw = await searchParams;
  let data: Awaited<ReturnType<typeof tutorLogs>>;
  try {
    data = await tutorLogs(actor.id, {
      from: raw.from || undefined,
      to: raw.to || undefined,
      subjectId: raw.subjectId || undefined,
      inaccurate: raw.inaccurate ?? "",
      page: raw.page ?? 1,
    });
  } catch (e) {
    if (e instanceof ContentError || e instanceof ZodError)
      return (
        <main>
          <h1 className="text-3xl font-semibold">Логи тьютора</h1>
          <p role="alert" className="my-5">
            Проверьте период и выбранный предмет.
          </p>
          <Link className="underline" href="/admin/tutor-logs">
            Сбросить фильтры
          </Link>
        </main>
      );
    throw e;
  }
  const spend =
    actor.role === "ADMIN"
      ? await spendSummary(data.range.start, data.range.end)
      : null;
  const link = (page: number) =>
    `/admin/tutor-logs?${new URLSearchParams({ from: data.range.from, to: data.range.to, subjectId: raw.subjectId ?? "", inaccurate: raw.inaccurate ?? "", page: String(page) })}`;
  return (
    <main className="mx-auto max-w-5xl">
      <h1 className="text-3xl font-semibold">Логи тьютора</h1>
      <p className="mt-4 text-sm leading-7">
        Вопросы и ответы без данных аккаунта. Учителю доступны только
        закреплённые предметы.
      </p>
      <ReportFilters {...data.range}>
        <label className="text-sm">
          Предмет
          <select
            className="mt-1 block min-h-11 max-w-full rounded-lg border bg-white p-2"
            name="subjectId"
            defaultValue={raw.subjectId ?? ""}
          >
            <option value="">Все доступные</option>
            {data.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="inaccurate"
            value="yes"
            defaultChecked={raw.inaccurate === "yes"}
          />
          Только «Неточно»
        </label>
      </ReportFilters>
      <section className="my-6 rounded-xl bg-emerald-50 p-5">
        <h2 className="font-semibold">Использование токенов по дням</h2>
        <p className="my-2 text-xs leading-6">
          По выбранным фильтрам. Токены не равны рублям; денежная стоимость
          зависит от договора с ИИ-провайдером.
        </p>
        {data.daily.map((d) => (
          <p key={d.day} className="mt-2 text-sm">
            {d.day}: входящих {d.input}, исходящих {d.output}
          </p>
        ))}
        {!data.daily.length && (
          <p className="mt-3 text-sm">Записей пока нет.</p>
        )}
      </section>
      {spend && (
        <section className="my-6 rounded-xl border p-5">
          <h2 className="font-semibold">Оценка расходов ИИ за период</h2>
          <p className="mt-3 text-sm">
            {spend.estimatedRub.toLocaleString("ru-RU", {
              maximumFractionDigits: 2,
            })}{" "}
            ₽ · запросов: {spend.requests} · без оценки: {spend.unknown}
          </p>
          <p className="mt-3 text-xs leading-6">
            Все предметы, тьютор, импорт и поиск; сутки UTC. Это оценка по
            тарифам в «Настройках», не счёт провайдера. Заполните стоимость
            миллиона токенов перед подключением реального ИИ. Для моделей без
            данных usage стоимость остаётся неизвестной. Проверка дневного
            бюджета выполняется каждые 15 минут, без автоматической остановки
            запросов.
          </p>
        </section>
      )}
      <p className="my-4 text-sm">Ответов: {data.total}</p>
      <div className="space-y-5">
        {data.items.map((r) => (
          <article key={r.id} className="rounded-2xl border bg-white p-5">
            <p className="text-xs text-stone-600">
              {r.subject} · {r.createdAt.slice(0, 16).replace("T", " ")} UTC ·{" "}
              {r.feedback === -1
                ? "Неточно"
                : r.feedback === 1
                  ? "Полезно"
                  : "Без оценки"}
            </p>
            <h2 className="mt-4 font-semibold">Вопрос</h2>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">
              {r.question}
            </p>
            <h3 className="mt-4 font-semibold">Ответ</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">
              {r.answer}
            </p>
            <ul className="mt-4 space-y-2">
              {r.citations.map((c) => (
                <li key={c.n}>
                  <Link
                    href={c.href}
                    className="text-sm text-emerald-800 underline"
                  >
                    [{c.n}] {c.title}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-stone-600">
              Модель: {r.model ?? "—"} · токены: {r.tokensIn ?? "—"} /{" "}
              {r.tokensOut ?? "—"}
            </p>
          </article>
        ))}
      </div>
      <nav className="mt-6 flex gap-5">
        {data.page > 1 && (
          <Link className="min-h-11 underline" href={link(data.page - 1)}>
            Назад
          </Link>
        )}
        {data.page < data.pages && (
          <Link className="min-h-11 underline" href={link(data.page + 1)}>
            Дальше
          </Link>
        )}
      </nav>
    </main>
  );
}
