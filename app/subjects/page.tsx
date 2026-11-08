import Link from "next/link";
import { publicMetadata } from "@/lib/ops/seo";
import { ArrowUpRight, BookOpen, Unlock } from "lucide-react";
import { LearningShell } from "@/components/lessons/shell";
import { getCurrentSession } from "@/lib/auth/server";
import { catalog, plans, formatPrice } from "@/lib/lessons/catalog";
export const dynamic = "force-dynamic";
export function generateMetadata() {
  return publicMetadata(
    "/subjects",
    "Предметы · Учебная платформа",
    "Методички с пропусками и тесты для студентов-стоматологов.",
  );
}
export default async function Subjects({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const query = await searchParams;
  const course =
    query.course && /^[1-6]$/.test(query.course)
      ? Number(query.course)
      : undefined;
  const session = await getCurrentSession();
  const [subjects, tariffs] = await Promise.all([
    catalog(session?.userId ?? null, course),
    plans(),
  ]);
  const price = tariffs.find((p) => p.kind === "SUBJECT");
  const groups = [...new Set(subjects.map((s) => s.courses.join("–")))];
  return (
    <LearningShell>
      <p className="text-xs font-semibold tracking-widest text-emerald-800 uppercase">
        Ваша подготовка
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
        Предметы
      </h1>
      <p className="mt-5 max-w-xl text-base leading-8 text-stone-600">
        Разбирайтесь в теме, заполняйте пропуски и проверяйте себя в тесте.
        Начните с бесплатного урока.
      </p>
      <nav aria-label="Фильтр по курсу" className="my-8 flex flex-wrap gap-2">
        {[undefined, 1, 2, 3, 4, 5, 6].map((c) => (
          <Link
            key={c ?? "all"}
            href={c ? `/subjects?course=${c}` : "/subjects"}
            aria-current={course === c ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${course === c ? "border-emerald-900 bg-emerald-900 text-white" : "border-stone-200 bg-white"}`}
          >
            {c === undefined
              ? "Все курсы"
              : c === 6
                ? "Выпускникам"
                : `${c} курс`}
          </Link>
        ))}
      </nav>
      {!subjects.length && (
        <div className="rounded-2xl border border-dashed border-stone-300 p-8">
          <BookOpen className="mb-4 text-emerald-700" aria-hidden />
          <h2 className="text-xl font-semibold">Материалы готовятся</h2>
          <p className="mt-3 text-sm leading-7 text-stone-600">
            Предметы появятся здесь после проверки и публикации редактором.
          </p>
        </div>
      )}
      {groups.map((group) => (
        <section key={group} className="mb-10">
          <h2 className="mb-5 text-lg font-semibold">
            {group ? `Курс ${group}` : "Для всех курсов"}
          </h2>
          <div className="grid gap-5 md:grid-cols-2">
            {subjects
              .filter((s) => s.courses.join("–") === group)
              .map((s) => {
                const topics = s.topic_subjectId;
                const completed = topics.filter(
                  (t) => t.topicProgress_topicId?.[0]?.completedAt,
                ).length;
                return (
                  <Link
                    key={s.id}
                    href={`/subjects/${s.slug}`}
                    className="group rounded-2xl border border-stone-200 bg-white p-6 transition hover:border-emerald-600 sm:p-8"
                  >
                    <div className="mb-6 flex justify-between gap-3">
                      <BookOpen className="text-emerald-700" aria-hidden />
                      <ArrowUpRight
                        size={20}
                        className="text-stone-400 group-hover:text-emerald-800"
                        aria-hidden
                      />
                    </div>
                    <h3 className="text-xl leading-8 font-semibold">
                      {s.title}
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-stone-600">
                      {s.shortDescription}
                    </p>
                    <p className="mt-5 text-sm text-stone-500">
                      Тем: {topics.length}
                      {price
                        ? ` · от ${formatPrice(price.priceKopecks)}/мес`
                        : ""}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs">
                      {topics.some((t) => t.isFree) && (
                        <span className="rounded-full bg-emerald-50 px-3 py-2 text-emerald-800">
                          Бесплатная тема
                        </span>
                      )}
                      {s.open && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-2 text-emerald-900">
                          <Unlock size={12} aria-hidden />
                          Открыт
                        </span>
                      )}
                    </div>
                    {session && (
                      <p className="mt-4 border-t border-stone-100 pt-4 text-xs text-stone-600">
                        Пройдено тем: {completed} / {topics.length}
                      </p>
                    )}
                  </Link>
                );
              })}
          </div>
        </section>
      ))}
    </LearningShell>
  );
}
