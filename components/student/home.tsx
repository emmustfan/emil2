import { SavedDiagnostic } from "@/components/demo/saved-diagnostic";
import Link from "next/link";
import { requireUser } from "@/lib/auth/server";
import { currentReviewSummary } from "@/components/review/link";
import { getDb } from "@/lib/db";
import { lessonHref } from "@/lib/lessons/catalog";
import { rolesRu as t } from "@/lib/i18n/ru";
import { studentOverview } from "@/lib/admin/cabinet";
import { courseMapTopics } from "@/lib/ui/course-map";
import { CourseMap } from "@/components/workspace/course-map";
export async function StudentHome() {
  const user = await requireUser(),
    [review, overview, topics, recent] = await Promise.all([
      currentReviewSummary(),
      studentOverview(user.id),
      courseMapTopics(user.id),
      getDb().topicProgress.findMany({
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
      }),
    ]);
  const completed = overview.subjects.reduce((sum, s) => sum + s.completed, 0);
  return (
    <main className="student-home">
      <div className="student-heading">
        <div>
          <p className="emal-eyebrow">
            Здравствуйте{user.name ? `, ${user.name}` : ""}
          </p>
          <h1>{user.role === "USER" ? t.studentTitle : t.myLearning}</h1>
          <p>
            Продолжайте учиться в своём темпе. Всё необходимое — в одном месте.
          </p>
        </div>
        <Link className="emal-button emal-button-outline" href="/subjects">
          Все предметы →
        </Link>
      </div>
      <div className="student-today">
        <section className="student-next">
          <p>Повторение на сегодня</p>
          <strong>{review?.dueCount ?? 0} карточек</strong>
          <p>
            {review?.dueCount
              ? "Вернитесь к материалу, который пора вспомнить. Ошибки из уроков уже здесь."
              : "После ответов в уроке здесь появятся карточки для закрепления знаний."}
          </p>
          <Link href="/review" className="lesson-primary">
            Повторить
          </Link>
          {review?.nextDueAt && (
            <small>
              Следующее повторение:{" "}
              {new Intl.DateTimeFormat("ru-RU", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: review.timeZone,
              }).format(new Date(review.nextDueAt))}
              .
            </small>
          )}
        </section>
        <div className="student-today-side">
          <section className="emal-panel">
            <h2>Продолжить урок</h2>
            {overview.recent ? (
              <>
                <p>{overview.recent.topic.title}</p>
                <Link
                  href={lessonHref(
                    overview.recent.topic.subject.slug,
                    overview.recent.topic.slug,
                  )}
                  className="emal-button emal-button-outline"
                >
                  Продолжить: {overview.recent.topic.title}
                </Link>
              </>
            ) : (
              <>
                <p>Выберите бесплатную тему и попробуйте первый урок.</p>
                <Link
                  href="/subjects"
                  className="emal-button emal-button-outline"
                >
                  {t.catalog}
                </Link>
              </>
            )}
          </section>
          <section className="emal-panel">
            <h2>Вопросы тьютору сегодня</h2>
            <p>
              Осталось вопросов ИИ сегодня: {overview.quota.remaining} из{" "}
              {overview.quota.limit}.
            </p>
            <div className="emal-progress">
              <span
                style={{
                  width: `${overview.quota.limit ? Math.min(100, (overview.quota.remaining / overview.quota.limit) * 100) : 0}%`,
                }}
              />
            </div>
            <p>Сегодня повторено: {review?.reviewedToday ?? 0}.</p>
          </section>
        </div>
      </div>
      <CourseMap topics={topics} />
      <SavedDiagnostic userId={user.id} />
      <div className="student-stats">
        <div>
          <small>Мои предметы</small>
          <strong>{overview.subjects.length}</strong>
        </div>
        <div>
          <small>Тем пройдено</small>
          <strong>{completed}</strong>
        </div>
        <div>
          <small>Повторено сегодня</small>
          <strong>{review?.reviewedToday ?? 0}</strong>
        </div>
      </div>
      <section className="mb-7">
        <div className="student-heading">
          <h2>Мои предметы</h2>
          <Link href="/subjects" className="text-sm underline">
            Открыть каталог
          </Link>
        </div>
        <div className="student-subjects">
          {overview.subjects.map((s) => (
            <article className="emal-panel" key={s.id}>
              <Link href={`/subjects/${s.slug}`}>{s.title}</Link>
              <p>
                Пройдено тем: {s.completed} из {s.total}. Средний лучший балл:{" "}
                {s.average === null ? "—" : `${Math.round(s.average * 100)}%`}.
              </p>
              <div className="emal-progress mt-4">
                <span
                  style={{
                    width: `${s.total ? (s.completed / s.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <p>
                {s.permitted && s.until
                  ? `Открыт до ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: user.timezone }).format(s.until)}`
                  : "Бесплатные темы"}
              </p>
            </article>
          ))}
        </div>
        {!overview.subjects.length && (
          <div className="emal-panel emal-muted">
            Откройте первый урок в каталоге — здесь появятся ваши предметы.
          </div>
        )}
      </section>
      <section className="emal-panel">
        <h2>{t.recentLearning}</h2>
        {recent.length ? (
          <ul className="mt-4 divide-y divide-stone-200">
            {recent.map((p, i) => (
              <li className="py-4" key={i}>
                <Link
                  href={lessonHref(p.topic.subject.slug, p.topic.slug)}
                  className="font-semibold"
                >
                  {p.topic.title} <span aria-hidden>→</span>
                </Link>
                <p className="mt-2 text-xs text-stone-600">
                  {p.topic.subject.title} ·{" "}
                  {p.completedAt ? t.completed : t.inProgress}
                </p>
                <p className="mt-2 text-sm">
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
          <p className="mt-4 text-sm emal-muted">{t.noLearning}</p>
        )}
      </section>
      {overview.quota.tier === "free" && (
        <p className="mt-6 emal-panel text-sm">
          Бесплатные темы доступны всегда.{" "}
          <Link className="underline" href="/pricing">
            Посмотреть доступ ко всем темам
          </Link>
          .
        </p>
      )}
    </main>
  );
}
