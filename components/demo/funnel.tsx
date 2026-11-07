"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import type { DemoView } from "@/lib/demo/service";
import type { DemoAction } from "@/lib/demo/flow";
import { AnswerCard } from "../exercises/answer-card";
import { Lesson } from "../lessons/lesson";
import { metrikaGoal } from "../landing/consent";
export function DemoFunnel({
  initial,
  tutorMock,
}: {
  initial: DemoView;
  tutorMock: boolean;
}) {
  const [view, setView] = useState(initial),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [goal, setGoal] = useState(""),
    [search, setSearch] = useState("");
  const busy = useRef(false);
  async function act(input: DemoAction) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const r = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const next = await r.json();
      if (!r.ok) throw new Error(next.error ?? "Не удалось сохранить шаг.");
      setView(next);
      if (next.step === 7) metrikaGoal("demo_completed");
      if (next.step !== view.step)
        window.scrollTo({ top: 0, behavior: "instant" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить шаг.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const button = (text: string, action: DemoAction) => (
    <button
      key={text}
      type="button"
      disabled={pending}
      className="lesson-primary"
      onClick={() => act(action)}
    >
      {text}
    </button>
  );
  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-emerald-800">
        Знакомство с платформой · Шаг {view.step} из 7
      </p>
      <progress
        aria-label="Прогресс демо"
        className="mb-8 h-1.5 w-full accent-emerald-800"
        max={7}
        value={view.step}
      />
      {error && (
        <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-red-900">
          {error}{" "}
          <Link href="/subjects" className="underline">
            Открыть каталог
          </Link>
        </p>
      )}
      {view.step === 1 && (
        <section className="max-w-2xl space-y-5">
          <h1 className="text-3xl font-semibold">К чему готовитесь?</h1>
          <p className="text-stone-600">
            Начните без регистрации. Ответы сохранятся в этом браузере, а после
            входа — в вашем аккаунте.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["debt", "Закрыть долги"],
                ["session", "Сдать сессию"],
                ["gia", "Подготовиться к ГИА"],
                ["understand", "Разобраться в предмете"],
              ] as const
            ).map(([goal, label]) => (
              <button
                key={goal}
                disabled={pending}
                className="min-h-14 rounded-xl border border-stone-300 bg-white p-4 text-left hover:border-emerald-700"
                onClick={() => act({ action: "goal", goal })}
              >
                {label}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act({ action: "goal", goal: "other", text: goal });
            }}
            className="space-y-3"
          >
            <label className="block">
              Своя цель
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                maxLength={200}
                className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white p-3"
              />
            </label>
            <button
              disabled={pending || !goal.trim()}
              className="lesson-primary"
            >
              Продолжить со своей целью
            </button>
          </form>
          {button("Пропустить — просто покажите урок", {
            action: "goal",
            goal: "skip",
          })}
        </section>
      )}
      {view.step === 2 && (
        <section className="max-w-2xl space-y-5">
          <h1 className="text-3xl font-semibold">Выберите предмет</h1>
          <p>
            Дальше — три вопроса из разных тем и бесплатный урок. После пропуска
            диагностики сразу откроется урок.
          </p>
          {view.subjects.length > 6 && (
            <label className="block">
              Найти предмет
              <input
                className="ml-3 rounded-lg border p-3"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          )}
          {!view.subjects.length && (
            <p className="rounded-xl border bg-white p-5">
              Предметы для демо ещё готовятся. В каталоге можно посмотреть уже
              опубликованные темы.{" "}
              <Link href="/subjects" className="underline">
                К предметам
              </Link>
            </p>
          )}
          {view.subjects
            .filter((s) =>
              s.title
                .toLocaleLowerCase("ru")
                .includes(search.toLocaleLowerCase("ru")),
            )
            .map((s) => (
              <div key={s.id}>
                {button(s.title, { action: "subject", subjectId: s.id })}
              </div>
            ))}
        </section>
      )}
      {view.step === 3 && view.question && (
        <section className="max-w-2xl space-y-5">
          <h1 className="text-3xl font-semibold">Короткая диагностика</h1>
          <p>
            Вопрос {view.answered + 1} из 3. Здесь проверяем знакомство с
            темами; подробный разбор будет в уроках.
          </p>
          {view.lastCorrect !== null && (
            <p role="status">
              Предыдущий ответ: {view.lastCorrect ? "верно" : "неверно"}.
            </p>
          )}
          <AnswerCard
            key={view.question.id}
            id={view.question.id}
            title={view.question.stem}
            answerType={view.question.answerType}
            options={view.question.options}
            feedback={null}
            pending={pending}
            onAnswer={(submission) =>
              act({
                action: "answer",
                questionId: view.question!.id,
                submission,
              })
            }
          />
        </section>
      )}
      {view.step === 4 && (
        <section className="max-w-3xl space-y-6">
          <h1 className="text-3xl font-semibold">
            Ваш результат: {view.correct} из 3
          </h1>
          <p>
            Это знакомство с тремя темами, а не оценка готовности к экзамену.
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            {[
              ["Уже знаете", view.strong],
              ["Стоит подтянуть", view.weak],
            ].map(([title, topics]) => (
              <div
                key={String(title)}
                className="rounded-2xl border border-stone-200 bg-white p-6"
              >
                <h2 className="mb-3 text-xl font-semibold">{title}</h2>
                <ul className="space-y-2">
                  {(topics as string[]).map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                {!(topics as string[]).length && (
                  <p>Пока нет тем в этом списке.</p>
                )}
              </div>
            ))}
          </div>
          {button("Попробовать урок", { action: "lesson" })}
          <Link
            href="/pricing"
            className="ml-5 inline-flex min-h-11 items-center underline"
          >
            Сразу к тарифам
          </Link>
        </section>
      )}
      {view.step === 5 && view.lesson && (
        <section>
          <h1 className="mb-4 text-3xl font-semibold">
            Попробуйте бесплатный урок
          </h1>
          <p className="mb-8 max-w-2xl text-stone-600">
            Прочитайте методичку, ответьте на пропуски и проверьте себя в тесте.
            Можно спросить тьютора или сразу перейти к повторению.
          </p>
          <Lesson
            key={`${view.lesson.topicId}:${view.lesson.version}`}
            initial={view.lesson}
            nextHref={null}
            tutorMock={tutorMock}
          />
          <div className="mt-10 border-t border-stone-200 pt-6">
            {button("Дальше — попробовать повторение", { action: "review" })}
          </div>
        </section>
      )}
      {view.step === 6 && (
        <section className="max-w-2xl space-y-6">
          <h1 className="text-3xl font-semibold">Так работает повторение</h1>
          <p>
            Карточки из ваших ответов на пропуски, сначала ошибки. Оценка
            назначает следующий повтор.
          </p>
          <p>
            Повторено: {view.reviewed} из {view.cardCount}
          </p>
          {view.card ? (
            <article className="rounded-2xl border border-stone-200 bg-white p-6">
              <h2 className="text-xl leading-8">{view.card.prompt}</h2>
              {view.card.answer === null ? (
                <div className="mt-6">
                  {button("Показать ответ", {
                    action: "reveal",
                    cardId: view.card.id,
                  })}
                </div>
              ) : (
                <>
                  <p className="mt-5 text-lg font-semibold text-emerald-800">
                    {view.card.answer}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    {view.card.intervals.map((i) =>
                      button(
                        `${{ HARD: "Сложно", GOOD: "Норм", EASY: "Легко" }[i.rating]} · ${i.label}`,
                        {
                          action: "rate",
                          cardId: view.card!.id,
                          rating: i.rating,
                        },
                      ),
                    )}
                  </div>
                </>
              )}
            </article>
          ) : (
            <>
              <p>
                {view.cardCount
                  ? "Отлично, карточки запланированы."
                  : "Пока нет ответов на пропуски — карточки появятся после урока. Можно сохранить аккаунт и продолжить позже."}
              </p>
              {button("Дальше — сохранить прогресс", { action: "finish" })}
            </>
          )}
        </section>
      )}
      {view.step === 7 && (
        <section className="max-w-2xl space-y-6">
          <h1 className="text-3xl font-semibold">
            Сохраните прогресс — продолжите там же
          </h1>
          <p>
            После входа и согласия на обработку данных в вашем аккаунте
            сохранятся:
          </p>
          <ul className="list-inside list-disc space-y-3">
            <li>Результат диагностики и выбранная цель</li>
            <li>Ответы в уроке и результаты тестов</li>
            <li>Карточки и назначенные даты повторения</li>
            <li>Переписка с тьютором</li>
          </ul>
          <Link href="/login" className="lesson-primary">
            Сохранить — войти по почте или через Telegram
          </Link>
          <p className="text-sm text-stone-500">
            Почта доступна всегда. Кнопка Telegram появляется, когда владелец
            подключит бота. До входа прогресс хранится в этом браузере{" "}
            {view.guestDays} дней.
          </p>
        </section>
      )}
    </div>
  );
}
