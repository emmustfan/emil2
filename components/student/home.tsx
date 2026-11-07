import Link from "next/link";
import { requireUser } from "@/lib/auth/server";
import { AuthShell } from "@/components/auth/shell";
import { currentReviewSummary } from "@/components/review/link";
import { getDb } from "@/lib/db";
import { lessonHref } from "@/lib/lessons/catalog";
import { rolesRu as t } from "@/lib/i18n/ru";
export async function StudentHome() {
  const user = await requireUser(),
    review = await currentReviewSummary();
  const recent = await getDb().topicProgress.findMany({
    where: {
      userId: user.id,
      topic: { status: "PUBLISHED", subject: { status: "PUBLISHED" } },
    },
    orderBy: { lastOpenedAt: "desc" },
    take: 8,
    select: {
      gapsAnswered: true,
      gapsCorrect: true,
      testBestScore: true,
      completedAt: true,
      topic: {
        select: {
          title: true,
          slug: true,
          subject: { select: { title: true, slug: true } },
        },
      },
    },
  });
  return (
    <AuthShell
      title={user.role === "USER" ? t.studentTitle : t.myLearning}
      description={t.studentDescription}
    >
      <Link href="/subjects" className="lesson-primary">
        {t.catalog}
      </Link>
      {review && (
        <section className="mt-7 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-lg font-semibold">{t.review}</h2>
          <p className="mt-3 text-sm leading-7">
            Готово карточек: {review.dueCount}. Сегодня повторено:{" "}
            {review.reviewedToday}.
          </p>
          {review.nextDueAt && (
            <p className="mt-2 text-xs leading-6 text-stone-600">
              Следующее повторение:{" "}
              {new Intl.DateTimeFormat("ru-RU", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: review.timeZone,
              }).format(new Date(review.nextDueAt))}
              .
            </p>
          )}
          <Link href="/review" className="lesson-primary mt-4">
            Открыть повторение
          </Link>
        </section>
      )}
      <section className="mt-8">
        <h2 className="text-xl font-semibold">{t.recentLearning}</h2>
        {recent.length ? (
          <ul className="mt-4 space-y-3">
            {recent.map((p, i) => (
              <li key={i} className="rounded-xl border border-stone-200 p-4">
                <Link
                  href={lessonHref(p.topic.subject.slug, p.topic.slug)}
                  className="font-semibold text-emerald-800 underline"
                >
                  {p.topic.title}
                </Link>
                <p className="mt-2 text-xs leading-6 text-stone-600">
                  {p.topic.subject.title} ·{" "}
                  {p.completedAt ? t.completed : t.inProgress}
                </p>
                <p className="mt-1 text-sm leading-7">
                  Пропусков: {p.gapsAnswered}, верно: {p.gapsCorrect}. Лучший
                  тест:{" "}
                  {p.testBestScore === null
                    ? "—"
                    : `${Math.round(p.testBestScore * 100)}%`}
                  .
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm leading-7 text-stone-600">
            {t.noLearning}
          </p>
        )}
      </section>
    </AuthShell>
  );
}
