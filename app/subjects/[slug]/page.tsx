import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Lock, ArrowRight, Check } from "lucide-react";
import { getDb } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/server";
import { catalog, lessonHref } from "@/lib/lessons/catalog";
import { LearningShell } from "@/components/lessons/shell";
import { SubjectPlans } from "@/components/lessons/plans";
import { SafeMarkdown } from "@/components/lessons/markdown";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const s = await getDb().subject.findFirst({
    where: { slug: (await params).slug, status: "PUBLISHED" },
    select: {
      title: true,
      seoTitle: true,
      seoDescription: true,
      shortDescription: true,
    },
  });
  return s
    ? {
        title: s.seoTitle ?? `${s.title} · Учебная платформа`,
        description: s.seoDescription ?? s.shortDescription,
      }
    : {};
}
export default async function Subject({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = (await params).slug;
  const session = await getCurrentSession();
  const subject = (await catalog(session?.userId ?? null)).find(
    (s) => s.slug === slug,
  );
  if (!subject) notFound();
  const [details, sections] = await Promise.all([
    getDb().subject.findUniqueOrThrow({
      where: { id: subject.id },
      select: { descriptionMd: true },
    }),
    getDb().section.findMany({
      where: { subjectId: subject.id },
      orderBy: [{ order: "asc" }, { title: "asc" }],
      select: { id: true, title: true },
    }),
  ]);
  const topics = subject.topic_subjectId;
  const continued = topics
    .filter(
      (t) =>
        !t.topicProgress_topicId?.[0]?.completedAt &&
        (t.isFree || subject.open),
    )
    .sort(
      (a, b) =>
        (b.topicProgress_topicId?.[0]?.lastOpenedAt.getTime() ?? 0) -
        (a.topicProgress_topicId?.[0]?.lastOpenedAt.getTime() ?? 0),
    )[0];
  const start = continued ?? topics.find((t) => t.isFree);
  const freeStart = !continued?.topicProgress_topicId?.length && start?.isFree;
  const groups = [
    ...sections,
    ...(topics.some((t) => t.sectionId === null)
      ? [{ id: null, title: "Темы предмета" }]
      : []),
  ];
  return (
    <LearningShell>
      <Link href="/subjects" className="text-sm text-emerald-800 underline">
        ← Все предметы
      </Link>
      <p className="mt-8 text-xs font-semibold tracking-widest text-emerald-800 uppercase">
        {subject.courses.length
          ? `Курс ${subject.courses.join("–")}`
          : "Для всех курсов"}
      </p>
      <h1 className="mt-4 max-w-4xl text-3xl leading-tight font-semibold tracking-tight sm:text-5xl">
        {subject.title}
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-8 text-stone-600">
        {subject.shortDescription}
      </p>
      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-500">
        <span>Тем: {topics.length}</span>
        <span>
          Пропусков: {topics.reduce((n, t) => n + t._count.gap_topicId, 0)}
        </span>
        <span>
          Вопросов: {topics.reduce((n, t) => n + t._count.question_topicId, 0)}
        </span>
      </div>
      {start && (
        <Link
          href={lessonHref(slug, start.slug)}
          className="lesson-primary mt-7"
        >
          {freeStart ? "Начать с бесплатной темы" : "Продолжить"}
          <ArrowRight size={16} aria-hidden />
        </Link>
      )}
      <div className="mt-12 space-y-8">
        {groups.map((g) => {
          const rows = topics.filter((t) => t.sectionId === g.id);
          return rows.length ? (
            <section key={g.id ?? "none"}>
              <h2 className="mb-4 text-xl font-semibold">{g.title}</h2>
              <div className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white">
                {rows.map((t, index) => {
                  const p = t.topicProgress_topicId?.[0];
                  const percent = t._count.gap_topicId
                    ? Math.round(
                        ((p?.gapsAnswered ?? 0) / t._count.gap_topicId) * 100,
                      )
                    : 0;
                  return (
                    <Link
                      key={t.id}
                      href={lessonHref(slug, t.slug)}
                      className="flex min-h-20 items-center gap-4 p-5 hover:bg-emerald-50/50"
                    >
                      <span className="text-sm text-stone-400">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 text-sm leading-6 font-medium">
                        {t.title}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-800">
                        {p?.completedAt ? (
                          <>
                            <Check size={14} aria-hidden />
                            Пройдено
                          </>
                        ) : p ? (
                          `Пройдено ${percent}%`
                        ) : t.isFree ? (
                          "Бесплатно"
                        ) : subject.open ? (
                          "Открыто"
                        ) : (
                          <>
                            <Lock size={14} aria-hidden />
                            Закрыто
                          </>
                        )}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null;
        })}
        {!topics.length && (
          <p className="rounded-xl border border-dashed border-stone-300 p-6 text-sm text-stone-600">
            Темы готовятся к публикации.
          </p>
        )}
      </div>
      <SubjectPlans subjectSlug={slug} />
      {details.descriptionMd && (
        <section className="mt-10 max-w-3xl">
          <h2 className="text-2xl font-semibold">О предмете</h2>
          <SafeMarkdown markdown={details.descriptionMd} />
        </section>
      )}
    </LearningShell>
  );
}
