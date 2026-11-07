"use client";
import { AnswerCard } from "@/components/exercises/answer-card";
import type { Submission } from "@/lib/exercises";
import Link from "next/link";
import { useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type {
  GapFeedback,
  LessonData,
  LessonProgress,
  LessonTest,
  LessonReview,
} from "@/lib/lessons/types";
import { LessonMarkdown } from "./markdown";
import { TutorPanel, type TutorHandle } from "@/components/tutor/panel";
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok)
    throw new Error(
      value.error ?? "Не удалось сохранить ответ. Попробуйте ещё раз.",
    );
  return value as T;
}
export function Lesson({
  initial,
  nextHref,
  tutorMock,
}: {
  initial: LessonData;
  nextHref: string | null;
  tutorMock: boolean;
}) {
  const [gaps, setGaps] = useState(initial.gaps);
  const [test, setTest] = useState(initial.test!);
  const [progress, setProgress] = useState(initial.progress!);
  const [review, setReview] = useState(initial.review!);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [practice, setPractice] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestInFlight = useRef(false);
  const tutor = useRef<TutorHandle>(null);
  async function run(id: string, task: () => Promise<void>) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setPending(id);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить ответ.");
    } finally {
      setPending(null);
      requestInFlight.current = false;
    }
  }
  async function answer(gapId: string, input: Submission) {
    await run(gapId, async () => {
      const data = await post<{
        feedback: GapFeedback;
        progress: LessonProgress;
        review: LessonReview;
      }>(`/api/gaps/${gapId}/answer`, {
        ...input,
        version: initial.version,
        practice,
      });
      setGaps((current) =>
        current.map((g) =>
          g.id === gapId ? { ...g, feedback: data.feedback } : g,
        ),
      );
      setProgress(data.progress);
      setReview(data.review);
      window.dispatchEvent(new Event("srs:changed"));
    });
  }
  function resetGaps() {
    setPractice(true);
    setAttempt((n) => n + 1);
    setGaps(gaps.map((g) => ({ ...g, feedback: null })));
    setError("");
  }
  const percentage = progress.total
    ? Math.round((progress.answered / progress.total) * 100)
    : 100;
  return (
    <>
      <div
        className="sticky top-0 z-20 -mx-5 mb-8 border-y border-stone-200 bg-[#f7f8f4]/95 px-5 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border"
        aria-label="Прогресс урока"
      >
        <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
          <span>{progress.completed ? "✓ Тема пройдена" : "Ваш прогресс"}</span>
          <span>
            Пропуски: {progress.answered} / {progress.total}
          </span>
        </div>
        <progress
          className="h-1.5 w-full accent-emerald-700"
          value={percentage}
          max={100}
          aria-label="Отвечено пропусков"
        />
      </div>
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-xl border border-red-300 bg-red-50 p-4 text-red-900"
        >
          {error}
        </p>
      )}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold tracking-widest text-emerald-800 uppercase">
              Методичка
            </p>
            <button
              type="button"
              disabled={!!pending}
              onClick={resetGaps}
              className="inline-flex min-h-11 items-center gap-2 text-sm text-stone-600 underline"
            >
              <RotateCcw size={14} aria-hidden />
              Пройти заново
            </button>
          </div>
          {practice && (
            <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Тренировочное прохождение. Статистика первого ответа сохранена.
            </p>
          )}
          <LessonMarkdown
            blocks={initial.blocks}
            gap={(id) => {
              const index = gaps.findIndex((g) => g.id === id);
              return (
                <a
                  href={`#exercise-${id}`}
                  aria-label={`Перейти к пропуску ${index + 1}`}
                  className="rounded bg-emerald-50 px-2 text-emerald-800"
                >
                  ____ {index + 1}
                </a>
              );
            }}
            afterBlock={(block) => (
              <div className="my-5 space-y-4">
                {gaps
                  .filter((g) => g.blockKey === block.blockKey)
                  .map((g) => (
                    <AnswerCard
                      key={`${g.id}-${attempt}`}
                      id={g.id}
                      title={`Пропуск ${gaps.indexOf(g) + 1}`}
                      description={g.stem}
                      answerType={g.answerType}
                      options={g.options}
                      feedback={g.feedback}
                      pending={!!pending}
                      onAnswer={(input) => void answer(g.id, input)}
                      onExplain={
                        !practice
                          ? () =>
                              tutor.current?.explain({
                                kind: "explain",
                                source: "GAP",
                                sourceId: g.id,
                                topicVersion: initial.version,
                              })
                          : undefined
                      }
                    />
                  ))}
              </div>
            )}
          />
          <section
            id="lesson-test"
            className="mt-12 border-t border-stone-200 pt-8"
          >
            <p className="text-xs font-semibold tracking-widest text-emerald-800 uppercase">
              Проверка знаний
            </p>
            <h2 className="mt-3 text-2xl font-semibold">Тест по теме</h2>
            <p className="mt-3 text-sm leading-7 text-stone-600">
              {test.questions.length} вопросов · Для прохождения нужно набрать{" "}
              {Math.round(initial.passThreshold * 100)}%. В прогресс идёт лучший
              результат.
            </p>
            {!test.runId || test.finished ? (
              <button
                className="lesson-primary mt-5"
                disabled={!!pending}
                onClick={() =>
                  run("test", async () => {
                    setTest(
                      await post<LessonTest>(
                        `/api/tests/${initial.topicId}/start`,
                        { version: initial.version },
                      ),
                    );
                  })
                }
              >
                {test.finished ? "Пройти тест заново" : "Начать тест"}
              </button>
            ) : null}
            {test.runId && (
              <div className="mt-7 space-y-5">
                {test.questions.map((q, index) => (
                  <AnswerCard
                    key={`${test.runId}-${q.id}`}
                    id={q.id}
                    title={`${index + 1}. ${q.stem}`}
                    answerType={q.answerType}
                    options={q.options}
                    feedback={
                      q.feedback
                        ? {
                            correct: q.feedback.correct,
                            chosenValues:
                              q.answerType === "SHORT_TEXT"
                                ? [q.feedback.chosenText ?? ""]
                                : q.feedback.chosenIds.map(
                                    (id) =>
                                      q.options.find((o) => o.id === id)
                                        ?.text ?? id,
                                  ),
                            correctValues:
                              q.answerType === "SHORT_TEXT"
                                ? [q.feedback.answerText ?? ""]
                                : q.feedback.correctIds.map(
                                    (id) =>
                                      q.options.find((o) => o.id === id)
                                        ?.text ?? id,
                                  ),
                            explanation: q.feedback.explanation,
                          }
                        : null
                    }
                    sourceBlockKey={q.feedback?.sourceBlockKey}
                    onExplain={() =>
                      tutor.current?.explain({
                        kind: "explain",
                        source: "QUESTION",
                        sourceId: q.id,
                        topicVersion: initial.version,
                        runId: test.runId!,
                      })
                    }
                    pending={!!pending}
                    onAnswer={(input) =>
                      void run(q.id, async () => {
                        const data = await post<{
                          test: LessonTest;
                          progress: LessonProgress;
                          review: LessonReview;
                        }>(`/api/tests/${initial.topicId}/answer`, {
                          runId: test.runId,
                          questionId: q.id,
                          ...input,
                        });
                        setTest(data.test);
                        setProgress(data.progress);
                        setReview(data.review);
                        window.dispatchEvent(new Event("srs:changed"));
                      })
                    }
                  />
                ))}
              </div>
            )}
          </section>
          {test.finished && (
            <section
              id="lesson-result"
              className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-6"
              aria-label="Итог урока"
            >
              <h2 className="text-2xl font-semibold">
                {progress.completed ? "Тема пройдена!" : "Продолжайте практику"}
              </h2>
              <p className="mt-3 leading-7">
                Результат теста:{" "}
                <strong>{Math.round((test.score ?? 0) * 100)}%</strong>. Лучший
                результат: {Math.round((progress.bestScore ?? 0) * 100)}%.
              </p>
              <p className="mt-2 text-sm leading-7">
                Пропуски: {progress.answered} из {progress.total}, верно{" "}
                {progress.correct}.
                {progress.answered < progress.total
                  ? " Ответьте на оставшиеся пропуски, чтобы завершить тему."
                  : ""}
              </p>
              {review?.signedIn ? (
                <div className="mt-4">
                  <p className="text-sm leading-7">
                    Карточек этой темы в повторении: {review.cards}.
                  </p>
                  <Link href="/review" className="lesson-primary mt-3">
                    Перейти к повторению
                  </Link>
                </div>
              ) : (
                <p className="mt-4 text-sm leading-7">
                  Войдите перед следующим уроком, чтобы собирать личную очередь
                  повторения в кабинете.
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-4">
                <a
                  href={`#b-${initial.blocks[0]?.blockKey}`}
                  className="inline-flex min-h-11 items-center text-sm underline"
                >
                  Вернуться к методичке
                </a>
                {nextHref && (
                  <Link href={nextHref} className="lesson-primary">
                    Следующая тема
                  </Link>
                )}
              </div>
            </section>
          )}
        </div>
        <aside className="hidden lg:block">
          <nav
            className="sticky top-28 rounded-2xl border border-stone-200 bg-white p-5 text-sm"
            aria-label="Содержание урока"
          >
            <p className="mb-3 font-semibold">В этом уроке</p>
            <a
              className="flex min-h-11 items-center text-emerald-800"
              href={`#b-${initial.blocks[0]?.blockKey}`}
            >
              01 · Методичка
            </a>
            <a
              className="flex min-h-11 items-center text-emerald-800"
              href="#lesson-test"
            >
              02 · Проверка знаний
            </a>
            <a
              className="flex min-h-11 items-center text-emerald-800"
              href="#lesson-tutor"
            >
              03 · ИИ-тьютор
            </a>
            <p className="mt-5 border-t border-stone-100 pt-5 text-xs leading-6 text-stone-500">
              Выберите вариант в каждом пропуске, затем пройдите тест. Ответы
              сохраняются автоматически.
            </p>
          </nav>
        </aside>
      </div>
      <div className="max-w-3xl">
        <TutorPanel ref={tutor} topicId={initial.topicId} mock={tutorMock} />
      </div>
    </>
  );
}
