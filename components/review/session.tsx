"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import type { ReviewQueue, ReviewBack, ReviewSummary } from "@/lib/srs/types";
import type { Rating } from "@/lib/srs/schedule";
async function request<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      data.error ?? "Не удалось загрузить повторение. Попробуйте ещё раз.",
    );
  return data;
}
function dateLabel(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}
export function ReviewSession({ initial }: { initial: ReviewQueue }) {
  const [queue, setQueue] = useState(initial),
    [back, setBack] = useState<ReviewBack | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const working = useRef(false);
  const startedAt = useRef(new Date().toISOString());
  const card = queue.cards[0],
    summary = queue.summary;
  const finish = useCallback(() => {
    fetch("/api/events", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "review_session_completed",
        props: { startedAt: startedAt.current },
      }),
    }).catch(() => {});
  }, []);
  useEffect(() => {
    window.addEventListener("pagehide", finish);
    return () => {
      window.removeEventListener("pagehide", finish);
      finish();
    };
  }, [finish]);
  useEffect(() => {
    if (!queue.cards.length && queue.summary.reviewedToday) finish();
  }, [queue.cards.length, queue.summary.reviewedToday, finish]);
  const run = useCallback(async (task: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить оценку.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, []);
  const reload = useCallback(
    () =>
      run(async () => {
        setQueue(await request<ReviewQueue>("/api/review/queue"));
        setBack(null);
        window.dispatchEvent(new Event("srs:changed"));
      }),
    [run],
  );
  const reveal = useCallback(() => {
    if (!card || back) return;
    void run(async () => {
      const answer = await request<ReviewBack>(`/api/review/${card.id}`, {
        action: "reveal",
        revision: card.revision,
        topicVersion: card.topicVersion,
      });
      try {
        const summary = await request<ReviewSummary>(
          "/api/review/queue?summary=1",
        );
        setQueue((current) => ({ ...current, summary }));
      } catch {
        // The reveal is already saved; the next queue load refreshes its counters.
      }
      setBack(answer);
      window.dispatchEvent(new Event("srs:changed"));
    });
  }, [card, back, run]);
  const rate = useCallback(
    (rating: Rating) => {
      if (!card || !back) return;
      void run(async () => {
        await request(`/api/review/${card.id}`, {
          action: "rate",
          rating,
          revision: card.revision,
          topicVersion: card.topicVersion,
        });
        const next = await request<ReviewQueue>("/api/review/queue");
        setQueue(next);
        setBack(null);
        window.dispatchEvent(new Event("srs:changed"));
      });
    },
    [card, back, run],
  );
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        target?.closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      if (e.code === "Space" && !target?.closest("button,a")) {
        e.preventDefault();
        reveal();
      }
      const rating = ({ "1": "HARD", "2": "GOOD", "3": "EASY" } as const)[
        e.key as "1" | "2" | "3"
      ];
      if (rating && back) {
        e.preventDefault();
        rate(rating);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [reveal, rate, back]);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-7 flex flex-wrap justify-between gap-3 text-sm text-stone-600">
        <p>
          Осталось сейчас: <strong>{summary.dueCount}</strong>
        </p>
        <p>
          Сегодня повторено: <strong>{summary.reviewedToday}</strong>
        </p>
      </div>
      {error && (
        <div
          className="mb-5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 min-h-11 underline"
            disabled={busy}
            onClick={() => void reload()}
          >
            Обновить очередь
          </button>
        </div>
      )}
      {card ? (
        <article
          className="rounded-3xl border border-emerald-900/10 bg-white p-6 shadow-sm sm:p-10"
          aria-label="Карточка повторения"
        >
          <p className="text-xs leading-6 text-stone-500">
            {card.subjectTitle} · {card.topicTitle}
          </p>
          <p className="mt-7 text-xs font-semibold tracking-widest text-emerald-800 uppercase">
            {card.source === "GAP"
              ? "Какой ответ пропущен?"
              : "Вспомните ответ"}
          </p>
          <h2 className="mt-4 text-xl leading-9 font-semibold sm:text-2xl">
            {card.prompt}
          </h2>
          {!back ? (
            <>
              <p className="mt-5 text-sm leading-7 text-stone-600">
                Попробуйте вспомнить ответ, затем проверьте себя.
              </p>
              <button
                type="button"
                aria-keyshortcuts="Space"
                disabled={busy}
                onClick={reveal}
                className="lesson-primary mt-7 w-full sm:w-auto"
              >
                {busy ? "Открываем…" : "Показать ответ"}
              </button>
            </>
          ) : (
            <div
              className="mt-7 border-t border-stone-200 pt-6"
              aria-label="Ответ карточки"
            >
              <p className="text-xs font-semibold text-emerald-800">
                {back.answers.length > 1
                  ? "Правильные ответы"
                  : "Правильный ответ"}
              </p>
              <ul className="mt-3 space-y-2 text-lg leading-8 font-semibold text-emerald-950">
                {back.answers.map((answer, i) => (
                  <li key={i} className="break-words">
                    {answer}
                  </li>
                ))}
              </ul>
              {back.alternatives.length > 0 && (
                <p className="mt-3 text-sm leading-7 text-stone-600">
                  Допустимо также: {back.alternatives.join("; ")}
                </p>
              )}
              {back.context && (
                <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm leading-8">
                  {back.context}
                </p>
              )}
              {back.explanation && (
                <p className="mt-5 text-sm leading-8 text-stone-700">
                  {back.explanation}
                </p>
              )}
              <Link
                href={back.lessonHref}
                className="mt-3 inline-flex min-h-11 items-center text-sm text-emerald-800 underline"
              >
                Открыть в методичке
              </Link>
              <p className="mt-7 mb-3 text-sm font-medium">
                Насколько легко вы вспомнили?
              </p>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {back.choices.map((choice, index) => (
                  <button
                    key={choice.rating}
                    type="button"
                    aria-keyshortcuts={String(index + 1)}
                    disabled={busy}
                    onClick={() => rate(choice.rating)}
                    className={`min-h-16 rounded-xl border p-3 text-sm disabled:opacity-50 ${choice.rating === "HARD" ? "border-amber-300 bg-amber-50 text-amber-950" : choice.rating === "GOOD" ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-emerald-800 bg-emerald-800 text-white"}`}
                  >
                    <span className="block font-semibold">
                      {choice.rating === "HARD"
                        ? "Сложно"
                        : choice.rating === "GOOD"
                          ? "Норм"
                          : "Легко"}
                    </span>
                    <span className="mt-1 block text-xs">{choice.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="mt-7 text-xs leading-6 text-stone-400">
            Пробел — показать ответ · 1 / 2 / 3 — оценка
          </p>
        </article>
      ) : (
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-7 sm:p-10">
          <h2 className="text-2xl font-semibold">
            {summary.reviewedToday || summary.nextDueAt || summary.newWaiting
              ? "На сегодня всё"
              : "Пока нет карточек"}
          </h2>
          <p className="mt-4 leading-8">
            {summary.reviewedToday
              ? `Сегодня вы повторили карточек: ${summary.reviewedToday}.`
              : "Карточки появятся после ответов в уроках и ошибок в тестах."}
          </p>
          {summary.newWaiting > 0 && (
            <p className="mt-3 text-sm leading-7">
              Лимит новых карточек на сегодня исчерпан. Остальные появятся
              завтра.
            </p>
          )}
          {summary.nextDueAt && (
            <p className="mt-3 text-sm leading-7">
              Следующие карточки:{" "}
              <time dateTime={summary.nextDueAt}>
                {dateLabel(summary.nextDueAt, summary.timeZone)}
              </time>
              .
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/subjects" className="lesson-primary">
              Продолжить учиться
            </Link>
            <button
              type="button"
              className="min-h-11 px-3 text-sm text-emerald-800 underline"
              disabled={busy}
              onClick={() => void reload()}
            >
              Проверить очередь
            </button>
          </div>
        </section>
      )}
      <p className="mt-5 text-xs leading-7 text-stone-500">
        Новых карточек показано сегодня: {summary.newShownToday} /{" "}
        {summary.newDailyLimit}. Даты — в вашем часовом поясе (
        {summary.timeZone}).
      </p>
    </div>
  );
}
