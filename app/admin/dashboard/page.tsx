import Link from "next/link";
import { requireAdmin } from "@/lib/auth/server";
import { dashboard } from "@/lib/admin/reports";
import { getEnv } from "@/lib/env";
import { ReportFilters } from "@/components/admin/report-filters";
import { formatPrice } from "@/lib/format";
import { ContentError } from "@/lib/content/errors";
import { ZodError } from "zod";
export const dynamic = "force-dynamic";
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; source?: string }>;
}) {
  const actor = await requireAdmin(),
    raw = await searchParams;
  let data: Awaited<ReturnType<typeof dashboard>>;
  try {
    data = await dashboard(actor.id, {
      from: raw.from || undefined,
      to: raw.to || undefined,
      source: raw.source ?? "",
    });
  } catch (e) {
    if (e instanceof ContentError || e instanceof ZodError)
      return (
        <main>
          <h1 className="text-3xl font-semibold">Статистика платформы</h1>
          <p role="alert" className="my-5">
            Выберите корректные даты и период не длиннее года.
          </p>
          <Link href="/admin/dashboard" className="underline">
            Сбросить фильтры
          </Link>
        </main>
      );
    throw e;
  }
  const labels: Record<string, string> = {
    landing_viewed: "Посетили главную",
    demo_started: "Начали демо",
    demo_completed: "Завершили демо",
    signup_completed: "Зарегистрировались",
    payment_succeeded: "Оплатили",
  };
  return (
    <main>
      <h1 className="text-3xl font-semibold">Статистика платформы</h1>
      {(getEnv().PAYMENTS_PROVIDER === "mock" ||
        getEnv().YOOKASSA_TEST_MODE) && (
        <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm">
          Тестовые платежи включены в отчёт. Эти суммы не являются настоящими
          поступлениями.
        </p>
      )}
      <ReportFilters {...data.range} source={data.source} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Поступления", formatPrice(data.gross)],
          ["Возвраты", formatPrice(data.refunds)],
          ["За вычетом возвратов", formatPrice(data.net)],
          ["Активные оплаченные подписки", data.active],
          ["MRR с автопродлением", formatPrice(data.mrr)],
        ].map(([label, value]) => (
          <article key={label} className="rounded-xl border bg-white p-5">
            <p className="text-sm text-stone-600">{label}</p>
            <p className="mt-3 text-2xl font-semibold">{value}</p>
          </article>
        ))}
      </div>
      <p className="mt-4 text-xs leading-6 text-stone-600">
        Поступления — по дате оплаты, возвраты — по дате возврата. Подписки и
        MRR показаны на текущий момент; MRR — месячная сумма активных оплаченных
        подписок с включённым автопродлением.
      </p>
      <div className="admin-report-panels">
        <section className="mt-8">
          <h2 className="text-xl font-semibold">Воронка за период</h2>
          <p className="mt-3 text-sm leading-7">
            Уникальные участники каждого шага в выбранном периоде. Это не одна
            когорта: оплата могла начаться до него, поэтому отношение соседних
            шагов может превышать 100%.
          </p>
          <ol className="mt-5 space-y-3">
            {data.funnel.map((row) => (
              <li key={row.name} className="rounded-xl border bg-white p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <span>{labels[row.name]}</span>
                  <strong>
                    {row.count}
                    {row.conversion !== null
                      ? ` · ${row.conversion}% от предыдущего шага`
                      : ""}
                  </strong>
                </div>
                <div
                  className="mt-3 h-2 rounded-full bg-stone-100"
                  aria-hidden="true"
                >
                  <div
                    className="h-2 rounded-full bg-[var(--gum)]"
                    style={{
                      width:
                        Math.min(
                          100,
                          data.funnel[0].count
                            ? (row.count / data.funnel[0].count) * 100
                            : 0,
                        ) + "%",
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="mt-8">
          <h2 className="text-xl font-semibold">Возвращаются к обучению</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {data.retention.map((r) => (
              <article key={r.day} className="rounded-xl border bg-white p-5">
                <h3 className="font-semibold">
                  На {r.day === 1 ? "следующий" : "седьмой"} день · D{r.day}
                </h3>
                <p className="mt-3">
                  {r.percent === null
                    ? "Ещё нет созревших регистраций"
                    : `${r.percent}% · ${r.retained} из ${r.mature}`}
                </p>
              </article>
            ))}
          </div>
          <p className="mt-3 text-xs leading-6 text-stone-600">
            Когорта — регистрации выбранного периода. День считается по UTC;
            учитываются только полностью прошедшие дни. Активность: ответы,
            тесты, повторение или вопрос тьютору.
          </p>
        </section>
      </div>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Платежи по UTM-источникам</h2>
        {!data.sources.length && (
          <p className="mt-4">За этот период платежей нет.</p>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {[
                  "Источник",
                  "Оплат",
                  "Поступления",
                  "Возвраты",
                  "Разница",
                ].map((t) => (
                  <th key={t} className="border-b p-3">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.sources.map((r) => (
                <tr key={r.source}>
                  <td className="border-b p-3">
                    <Link
                      className="underline"
                      href={`/admin/dashboard?from=${data.range.from}&to=${data.range.to}&source=${encodeURIComponent(r.source || "__direct__")}`}
                    >
                      {r.source || "Без UTM"}
                    </Link>
                  </td>
                  <td className="border-b p-3">{r.payments}</td>
                  <td className="border-b p-3">{formatPrice(r.gross)}</td>
                  <td className="border-b p-3">{formatPrice(r.refunds)}</td>
                  <td className="border-b p-3">{formatPrice(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
