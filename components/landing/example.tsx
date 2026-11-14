"use client";
import { useState } from "react";
import { AnswerCard, type AnswerFeedback } from "../exercises/answer-card";
import type { publicExamples } from "@/lib/landing/content";
export function LandingExample({
  examples,
}: {
  examples: ReturnType<typeof publicExamples>;
}) {
  const [feedback, setFeedback] = useState<Record<string, AnswerFeedback>>({}),
    [answer, setAnswer] = useState<string | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [rated, setRated] = useState("");
  async function post(
    input: unknown,
    done: (data: AnswerFeedback & { answer: string }) => void,
  ) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const r = await fetch("/api/landing-example", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      done(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Попробуйте снова.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-5">
      {error && <p role="alert">{error}</p>}
      <div className="grid items-start gap-5 md:grid-cols-2">
        {examples.map((e) => (
          <AnswerCard
            key={e.id}
            id={e.id}
            title={e.stem}
            answerType={e.answerType}
            options={e.options}
            feedback={feedback[e.id] ?? null}
            pending={pending}
            onAnswer={(submission) =>
              post({ action: "answer", id: e.id, submission }, (data) =>
                setFeedback((f) => ({ ...f, [e.id]: data })),
              )
            }
          />
        ))}
      </div>
      <article className="rounded-2xl border border-stone-200 bg-white p-6">
        <p className="mb-3 text-xs font-semibold tracking-widest text-emerald-800 uppercase">
          Карточка для повторения
        </p>
        <h3 className="text-xl">{examples[0].stem}</h3>
        {answer === null ? (
          <button
            className="lesson-primary mt-5"
            disabled={pending}
            onClick={() =>
              post({ action: "reveal" }, (data) => setAnswer(data.answer))
            }
          >
            Показать ответ карточки
          </button>
        ) : (
          <>
            <p className="my-5 font-semibold text-emerald-800">{answer}</p>
            {rated ? (
              <p role="status">{rated}</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {["Сложно", "Норм", "Легко"].map((text) => (
                  <button
                    key={text}
                    className="lesson-primary"
                    onClick={() =>
                      setRated(
                        "Так назначается следующий повтор. В демо карточки сохранятся в вашем прогрессе.",
                      )
                    }
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </article>
      <p className="text-sm text-stone-600">
        Немедицинский пример интерфейса. Ответы в этом блоке не сохраняются;
        после обновления можно попробовать заново.
      </p>
    </div>
  );
}
