import type { StudentProgress } from "@/lib/progress/student";
const percent = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`;
export function StudentProgressCard({
  data,
  timeZone,
}: {
  data: StudentProgress;
  timeZone: string;
}) {
  const date = (value: string) =>
    new Date(value).toLocaleString("ru-RU", { timeZone });
  const max = Math.max(1, ...data.activity.map((d) => d.count));
  return (
    <div className="space-y-7">
      <section className="emal-panel space-y-3 p-5">
        <h2 className="text-xl font-semibold">Итоги обучения</h2>
        {data.summary?.lagging && (
          <p className="text-amber-900">Отстающий по заданным порогам</p>
        )}
        <p>
          Завершено тем: {data.summary?.completed ?? 0} из{" "}
          {data.summary?.totalTopics ?? 0} · Средний балл тестов:{" "}
          {percent(data.summary?.average)}
        </p>
        <p>
          Последняя активность:{" "}
          {data.summary?.lastActivity
            ? date(data.summary.lastActivity)
            : "Пока нет"}
        </p>
        <p className="text-sm text-stone-500">
          Средний балл — среднее лучших результатов по изученным опубликованным
          темам.
        </p>
      </section>
      <section className="emal-panel space-y-3 p-5">
        <h2 className="text-xl font-semibold">Повторение</h2>
        <p>
          Карточек всего: {data.review.total} · К повторению: {data.review.due}{" "}
          · Просрочено: {data.review.overdue}
        </p>
        <p className="text-sm text-stone-500">
          К повторению — доступные карточки без суточного лимита. Просрочены
          карточки до начала сегодняшнего дня по времени студента.
        </p>
        <h3 className="font-medium">Самооценка студента за 30 дней</h3>
        <p>
          Сложно: {data.review.ratings.HARD} · Нормально:{" "}
          {data.review.ratings.GOOD} · Легко: {data.review.ratings.EASY}
        </p>
      </section>
      <section className="emal-panel space-y-3 p-5">
        <h2 className="text-xl font-semibold">Активность за 30 дней</h2>
        <div
          role="img"
          aria-label="Учебные действия по дням, UTC"
          className="flex h-28 items-end gap-1"
        >
          {data.activity.map((d) => (
            <div
              key={d.day}
              title={`${d.day}: ${d.count} действий`}
              aria-label={`${d.day}: ${d.count} действий`}
              className="min-w-0 flex-1 rounded-t bg-emerald-600"
              style={{
                height: `${Math.max(2, (d.count / max) * 100)}%`,
                opacity: d.count ? 1 : 0.15,
              }}
            />
          ))}
        </div>
        <p className="text-xs text-stone-500">
          {data.activity[0]?.day} — {data.activity.at(-1)?.day} · UTC
        </p>
      </section>
      <section className="emal-panel space-y-2 p-5">
        <h2 className="text-xl font-semibold">Обращения к тьютору</h2>
        <p>
          Вопросов: {data.tutor.total}. Содержимое переписки не показывается.
        </p>
      </section>
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Темы и ответы</h2>
        {!data.topics.length && <p>Учебной активности пока нет.</p>}
        {data.topics.map((topic, index) => (
          <details key={topic.id} open={index === 0} className="emal-panel p-5">
            <summary className="cursor-pointer font-semibold">
              {topic.subject.title} · {topic.title} ·{" "}
              {topic.progress?.completedAt
                ? "Завершена"
                : topic.progress
                  ? "В процессе"
                  : "Не начата"}
            </summary>
            <div className="mt-5 space-y-5">
              <p className="text-sm">
                Пропусков отвечено: {topic.progress?.gapsAnswered ?? 0}; верно:{" "}
                {topic.progress?.gapsCorrect ?? 0}. Лучший тест:{" "}
                {percent(topic.progress?.testBestScore)}. Вопросов тьютору:{" "}
                {topic.tutorQuestions}.
              </p>
              {topic.needsExpertReview && (
                <p className="rounded bg-amber-50 p-3 text-sm">
                  Демонстрационный медицинский материал требует проверки
                  специалистом.
                </p>
              )}
              <h3 className="text-lg font-medium">Пропуски</h3>
              {topic.gaps.map((gap, i) => (
                <details key={gap.id} className="rounded-xl border p-4">
                  <summary className="cursor-pointer">
                    Пропуск {i + 1}: {gap.sentence}
                    {gap.archived ? " · архив" : ""}
                  </summary>
                  <div className="mt-3 space-y-2 text-sm">
                    <p>
                      Первый ответ:{" "}
                      {gap.first
                        ? `${gap.first.chosen.join("; ")} · ${gap.first.correct ? "Верно" : "Неверно"}`
                        : "Нет ответа"}
                    </p>
                    <p>Правильный ответ: {gap.correct.join("; ")}</p>
                    <h4 className="font-medium">
                      Все попытки ({gap.attempts.length})
                    </h4>
                    {gap.attempts.map((attempt) => (
                      <div className="rounded bg-stone-50 p-3" key={attempt.id}>
                        <p>
                          {date(attempt.at)} ·{" "}
                          {attempt.practice ? "Практика" : "Ответ в уроке"} ·{" "}
                          {attempt.isCorrect ? "Верно" : "Неверно"}
                        </p>
                        <p>
                          Ответ студента:{" "}
                          {attempt.text ?? attempt.chosen.join("; ")}
                        </p>
                        <p>
                          Правильный ответ:{" "}
                          {attempt.correct.length
                            ? attempt.correct.join("; ")
                            : "Эталон прежней версии недоступен"}
                        </p>
                        {attempt.oldVersion && (
                          <p className="text-amber-900">
                            Ответ к версии {attempt.version}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              ))}
              <h3 className="text-lg font-medium">
                Тесты ({topic.tests.length})
              </h3>
              {topic.tests.map((run) => (
                <details key={run.id} className="rounded-xl border p-4">
                  <summary className="cursor-pointer">
                    {date(run.at)} ·{" "}
                    {run.finished ? percent(run.score) : "Не завершён"} ·{" "}
                    {run.seconds === null
                      ? "В процессе"
                      : `${run.seconds} сек.`}
                    {run.oldVersion
                      ? ` · Ответ к версии ${run.version ?? "неизвестной"}`
                      : ""}
                  </summary>
                  <div className="mt-3 space-y-3">
                    {run.answers.map((answer) => (
                      <div
                        className="rounded bg-stone-50 p-3 text-sm"
                        key={answer.id}
                      >
                        <p className="font-medium">
                          {answer.stem} ·{" "}
                          {answer.isCorrect ? "Верно" : "Неверно"}
                        </p>
                        <p>Ответ студента: {answer.chosen.join("; ")}</p>
                        <p>
                          Правильный ответ:{" "}
                          {answer.correct.length
                            ? answer.correct.join("; ")
                            : "Эталон прежней версии недоступен"}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
              {!topic.tests.length && (
                <p className="text-sm">Тесты пока не запускались.</p>
              )}
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
