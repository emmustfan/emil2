import { SavedDiagnostic } from "@/components/demo/saved-diagnostic";
import Link from "next/link";
import { requireUser } from "@/lib/auth/server";
import { AuthShell } from "@/components/auth/shell";
import { currentReviewSummary } from "@/components/review/link";
import { getDb } from "@/lib/db";
import { lessonHref } from "@/lib/lessons/catalog";
import { rolesRu as t } from "@/lib/i18n/ru";
import { studentOverview } from "@/lib/admin/cabinet";
export async function StudentHome() {
  const user = await requireUser(),
    [review, overview] = await Promise.all([
      currentReviewSummary(),
      studentOverview(user.id),
    ]);
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
      <SavedDiagnostic userId={user.id} />
      <section className="mt-7 rounded-xl border bg-white p-5">
        <h2 className="text-lg font-semibold">Сегодня</h2>
        <p className="mt-3 text-sm leading-7">
          К повторению: {review?.dueCount ?? 0}. Осталось вопросов ИИ сегодня:{" "}
          {overview.quota.remaining} из {overview.quota.limit}.
        </p>
        <div className="mt-4 flex flex-wrap gap-4">
          <Link href="/review" className="lesson-primary">
            Повторить
          </Link>
          {overview.recent && (
            <Link
              href={lessonHref(
                overview.recent.topic.subject.slug,
                overview.recent.topic.slug,
              )}
              className="lesson-primary"
            >
              Продолжить: {overview.recent.topic.title}
            </Link>
          )}
        </div>
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Мои предметы</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {overview.subjects.map((s) => (
            <article key={s.id} className="rounded-xl border bg-white p-5">
              <Link
                href={`/subjects/${s.slug}`}
                className="font-semibold text-emerald-800 underline"
              >
                {s.title}
              </Link>
              <p className="mt-3 text-sm">
                Пройдено тем: {s.completed} из {s.total}. Средний лучший балл:{" "}
                {s.average === null ? "—" : `${Math.round(s.average * 100)}%`}.
              </p>
              <p className="mt-3 text-sm">
                {s.permitted && s.until
                  ? `Открыт до ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: user.timezone }).format(s.until)}`
                  : "Бесплатные темы"}
              </p>
            </article>
          ))}
        </div>
        {!overview.subjects.length && (
          <p className="mt-4 text-sm">
            Откройте первый урок в каталоге — здесь появятся ваши предметы.
          </p>
        )}
      </section>
      {overview.quota.tier === "free" && (
        <p className="mt-6 rounded-xl bg-emerald-50 p-5 text-sm leading-7">
          Бесплатные темы доступны всегда.{" "}
          <Link className="underline" href="/pricing">
            Посмотреть доступ ко всем темам
          </Link>
          .
        </p>
      )}
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
