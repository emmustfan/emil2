"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Check, ChevronDown, RotateCcw, X } from "lucide-react";
import type {
  GapFeedback,
  LessonData,
  LessonGap,
  LessonProgress,
  LessonTest,
  Option,
} from "@/lib/lessons/types";
import { LessonMarkdown } from "./markdown";
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
function Gap({
  gap,
  answer,
  pending,
}: {
  gap: LessonGap;
  answer: (optionId: string) => Promise<void>;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const feedback = gap.feedback;
  function move(index: number) {
    options.current[(index + gap.options.length) % gap.options.length]?.focus();
  }
  return (
    <span
      className="relative inline-block max-w-full align-baseline"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={
          feedback
            ? `Пропуск: ${feedback.chosen}. ${feedback.correct ? "Верно" : "Неверно"}`
            : "Заполнить пропуск"
        }
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={pending}
        aria-disabled={!!feedback}
        onClick={() => {
          if (!feedback) setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (feedback) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              move(e.key === "ArrowUp" ? gap.options.length - 1 : 0),
            );
          }
        }}
        className={`inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border px-3 py-1 align-baseline font-medium ${feedback ? (feedback.correct ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-red-400 bg-red-50 text-red-900") : "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"}`}
      >
        {feedback ? (
          <>
            <span className={feedback.correct ? "" : "line-through"}>
              {feedback.chosen}
            </span>
            {feedback.correct ? (
              <Check size={15} aria-hidden />
            ) : (
              <X size={15} aria-hidden />
            )}
          </>
        ) : (
          <>
            {pending ? "…" : "____"}
            <ChevronDown size={14} aria-hidden />
          </>
        )}
      </button>
      {open && !feedback && (
        <span
          className="absolute top-full left-0 z-30 mt-1 flex w-64 max-w-[calc(100vw-3.5rem)] flex-col gap-1 rounded-xl border border-stone-200 bg-white p-2 shadow-xl"
          role="menu"
          aria-label="Варианты ответа"
          onKeyDown={(e) => {
            const at = options.current.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              move(
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? gap.options.length - 1
                    : at + (e.key === "ArrowUp" ? -1 : 1),
              );
            }
            if (e.key === "Escape") {
              setOpen(false);
              button.current?.focus();
            }
          }}
        >
          {gap.options.map((option, i) => (
            <button
              key={option.id}
              ref={(el) => {
                options.current[i] = el;
              }}
              role="menuitem"
              type="button"
              className="min-h-11 rounded-lg px-3 py-2 text-left text-sm break-words hover:bg-emerald-50"
              onClick={async () => {
                setOpen(false);
                await answer(option.id);
                button.current?.focus();
              }}
            >
              {option.text}
            </button>
          ))}
        </span>
      )}
      {feedback && (
        <span
          className={`ml-2 text-sm ${feedback.correct ? "text-emerald-800" : "text-red-800"}`}
          role="status"
        >
          {feedback.correct ? (
            "Верно"
          ) : (
            <>
              Неверно. Правильно: <strong>{feedback.answer}</strong>
            </>
          )}
        </span>
      )}
    </span>
  );
}
export function Lesson({
  initial,
  nextHref,
}: {
  initial: LessonData;
  nextHref: string | null;
}) {
  const [gaps, setGaps] = useState(initial.gaps);
  const [test, setTest] = useState(initial.test!);
  const [progress, setProgress] = useState(initial.progress!);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [practice, setPractice] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const requestInFlight = useRef(false);
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
  async function answer(gapId: string, optionId: string) {
    await run(gapId, async () => {
      const data = await post<{
        feedback: GapFeedback;
        progress: LessonProgress;
      }>(`/api/gaps/${gapId}/answer`, {
        optionId,
        version: initial.version,
        practice,
      });
      setGaps((current) =>
        current.map((g) =>
          g.id === gapId ? { ...g, feedback: data.feedback } : g,
        ),
      );
      setProgress(data.progress);
    });
  }
  function resetGaps() {
    setPractice(true);
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
              const gap = gaps.find((g) => g.id === id);
              return gap ? (
                <Gap
                  key={id}
                  gap={gap}
                  answer={(optionId) => answer(id, optionId)}
                  pending={!!pending}
                />
              ) : (
                "____"
              );
            }}
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
                    setSelected({});
                  })
                }
              >
                {test.finished ? "Пройти тест заново" : "Начать тест"}
              </button>
            ) : null}
            {test.runId && (
              <div className="mt-7 space-y-5">
                {test.questions.map((q, index) => (
                  <form
                    key={`${test.runId}-${q.id}`}
                    className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-7"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!selected[q.id]) return;
                      void run(q.id, async () => {
                        const data = await post<{
                          test: LessonTest;
                          progress: LessonProgress;
                        }>(`/api/tests/${initial.topicId}/answer`, {
                          runId: test.runId,
                          questionId: q.id,
                          chosenId: selected[q.id],
                        });
                        setTest(data.test);
                        setProgress(data.progress);
                      });
                    }}
                  >
                    <fieldset disabled={!!q.feedback || !!pending}>
                      <legend className="mb-4 font-semibold leading-7">
                        <span className="mr-2 text-stone-400">
                          {index + 1}.
                        </span>
                        {q.stem}
                      </legend>
                      <div className="space-y-2">
                        {q.options.map((option: Option) => (
                          <label
                            key={option.id}
                            className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm leading-6 ${q.feedback?.correctId === option.id ? "border-emerald-500 bg-emerald-50" : q.feedback?.chosenId === option.id ? "border-red-300 bg-red-50" : "border-stone-200"}`}
                          >
                            <input
                              type="radio"
                              name={`question-${q.id}`}
                              value={option.id}
                              className="mt-1 accent-emerald-800"
                              checked={
                                (q.feedback?.chosenId ?? selected[q.id]) ===
                                option.id
                              }
                              onChange={() =>
                                setSelected({ ...selected, [q.id]: option.id })
                              }
                            />
                            {option.text}
                          </label>
                        ))}
                      </div>
                      {!q.feedback && (
                        <button
                          className="lesson-primary mt-4"
                          disabled={!selected[q.id]}
                        >
                          Ответить
                        </button>
                      )}
                    </fieldset>
                    {q.feedback && (
                      <div
                        className="mt-4 border-t border-stone-100 pt-4 text-sm leading-7"
                        role="status"
                      >
                        <p
                          className={
                            q.feedback.correct
                              ? "font-semibold text-emerald-800"
                              : "font-semibold text-red-800"
                          }
                        >
                          {q.feedback.correct ? "✓ Верно" : "✕ Неверно"}
                        </p>
                        <p>{q.feedback.explanation}</p>
                        {q.feedback.sourceBlockKey && (
                          <a
                            className="text-emerald-800 underline"
                            href={`#b-${q.feedback.sourceBlockKey}`}
                          >
                            В методичке
                          </a>
                        )}
                      </div>
                    )}
                  </form>
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
            <p className="mt-5 border-t border-stone-100 pt-5 text-xs leading-6 text-stone-500">
              Выберите вариант в каждом пропуске, затем пройдите тест. Ответы
              сохраняются автоматически.
            </p>
          </nav>
        </aside>
      </div>
    </>
  );
}
