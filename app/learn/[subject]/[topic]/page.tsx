import { publicMetadata } from "@/lib/ops/seo";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { LockKeyhole } from "lucide-react";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { lessonActor } from "@/lib/lessons/actor";
import { loadLesson } from "@/lib/lessons/service";
import { ContentError } from "@/lib/content/errors";
import { AuthError } from "@/lib/auth/errors";
import { LearningShell } from "@/components/lessons/shell";
import { Lesson } from "@/components/lessons/lesson";
import { LessonMarkdown, SafeMarkdown } from "@/components/lessons/markdown";
import { lessonHref, plans, formatPrice } from "@/lib/lessons/catalog";
export const dynamic = "force-dynamic";
async function findTopic(subject: string, topic: string) {
  return getDb().topic.findFirst({
    where: {
      slug: topic,
      status: "PUBLISHED",
      subject: { slug: subject, status: "PUBLISHED" },
    },
    select: {
      id: true,
      isFree: true,
      needsExpertReview: true,
      title: true,
      order: true,
      readingMinutes: true,
      authorName: true,
      reviewerName: true,
      reviewedAt: true,
      referencesMd: true,
      subjectId: true,
      section: { select: { title: true } },
      subject: { select: { title: true } },
    },
  });
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ subject: string; topic: string }>;
}): Promise<Metadata> {
  const p = await params,
    t = await findTopic(p.subject, p.topic);
  return t && t.isFree && !t.needsExpertReview && t.reviewedAt
    ? publicMetadata(
        `/learn/${p.subject}/${p.topic}`,
        `${t.title} · ${t.subject.title}`,
      )
    : {
        title: t ? `${t.title} · ${t.subject.title}` : "Тема не найдена",
        robots: { index: false, follow: false },
      };
}
export default async function Learn({
  params,
}: {
  params: Promise<{ subject: string; topic: string }>;
}) {
  const p = await params,
    topic = await findTopic(p.subject, p.topic);
  if (!topic) notFound();
  let data;
  try {
    data = await loadLesson(topic.id, await lessonActor());
  } catch (e) {
    if (e instanceof AuthError) redirect("/onboarding");
    if (e instanceof ContentError && e.status === 404) notFound();
    if (e instanceof ContentError && e.status === 429)
      return (
        <LearningShell>
          <h1 className="text-2xl font-semibold">Подождите минуту</h1>
          <p className="mt-4">{e.message}</p>
        </LearningShell>
      );
    throw e;
  }
  const following = await getDb().topic.findMany({
    where: { subjectId: topic.subjectId, status: "PUBLISHED" },
    orderBy: [{ order: "asc" }, { id: "asc" }],
    select: { id: true, slug: true },
  });
  const next = following[following.findIndex((t) => t.id === topic.id) + 1];
  const price = data.locked
    ? (await plans()).find((p) => p.kind === "SUBJECT")
    : null;
  return (
    <LearningShell>
      <nav
        aria-label="Хлебные крошки"
        className="mb-7 flex flex-wrap gap-2 text-xs leading-6 text-stone-500"
      >
        <Link className="text-emerald-800 underline" href="/subjects">
          Предметы
        </Link>
        <span>/</span>
        <Link
          className="text-emerald-800 underline"
          href={`/subjects/${p.subject}`}
        >
          {topic.subject.title}
        </Link>
        {topic.section && (
          <>
            <span>/</span>
            <span>{topic.section.title}</span>
          </>
        )}
      </nav>
      <h1 className="max-w-4xl text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
        {topic.title}
      </h1>
      <p className="mt-4 mb-8 text-sm text-stone-500">
        {topic.readingMinutes ? `${topic.readingMinutes} мин чтения · ` : ""}
        Методичка и тест
      </p>
      {data.locked ? (
        <div className="max-w-3xl">
          <LessonMarkdown blocks={data.blocks} />
          <section className="relative mt-6 overflow-hidden rounded-2xl border border-emerald-200 bg-white p-7 text-center sm:p-10">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 space-y-5 p-8 opacity-20 blur-sm"
            >
              <div className="h-3 w-4/5 rounded bg-stone-300" />
              <div className="h-3 rounded bg-stone-300" />
              <div className="h-3 w-3/5 rounded bg-stone-300" />
            </div>
            <div className="relative">
              <LockKeyhole
                className="mx-auto mb-5 text-emerald-800"
                aria-hidden
              />
              <h2 className="text-2xl font-semibold">
                Откройте предмет
                {price ? ` — ${formatPrice(price.priceKopecks)}/мес` : ""}
              </h2>
              <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-stone-600">
                Полная методичка и тест доступны с подпиской на предмет. Пока
                можно изучать бесплатную тему.
              </p>
              <Link
                className="lesson-primary mt-6"
                href={`/subjects/${p.subject}#plans`}
              >
                Посмотреть доступ
              </Link>
              <Link
                className="mt-4 block text-sm text-emerald-800 underline"
                href={`/subjects/${p.subject}`}
              >
                К темам предмета
              </Link>
            </div>
          </section>
        </div>
      ) : (
        <Lesson
          tutorMock={getEnv().LLM_PROVIDER === "mock"}
          key={`${topic.id}:${data.version}`}
          initial={data}
          nextHref={next ? lessonHref(p.subject, next.slug) : null}
        />
      )}
      {!data.locked && (
        <section
          className="mt-12 max-w-3xl border-t border-stone-200 pt-7 text-sm leading-7 text-stone-600"
          aria-label="Проверка материала"
        >
          <p>
            Автор: {topic.authorName ?? "—"} · Рецензент:{" "}
            {topic.reviewerName ?? "—"}
          </p>
          {topic.reviewedAt && (
            <p>
              Проверено{" "}
              {new Intl.DateTimeFormat("ru-RU", {
                timeZone: "Europe/Moscow",
              }).format(topic.reviewedAt)}
            </p>
          )}
          {topic.referencesMd && (
            <>
              <h2 className="mt-4 font-semibold">Источники</h2>
              <SafeMarkdown markdown={topic.referencesMd} />
            </>
          )}
        </section>
      )}
    </LearningShell>
  );
}
