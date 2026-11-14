"use client";
import { useState } from "react";
import type { AnswerType, Choice, Submission } from "@/lib/exercises";
import { tutorRu } from "@/lib/i18n/ru";
import { exerciseRu as t } from "@/lib/exercises/ru";
export type AnswerFeedback = {
  correct: boolean;
  chosenValues: string[];
  correctValues: string[];
  explanation: string;
};
export function AnswerCard({
  id,
  title,
  description,
  answerType,
  options,
  feedback,
  pending = false,
  onAnswer,
  sourceBlockKey,
  form = true,
  onExplain,
}: {
  id: string;
  title: string;
  description?: string;
  answerType: AnswerType;
  options: Choice[];
  feedback: AnswerFeedback | null;
  pending?: boolean;
  onAnswer: (input: Submission) => void;
  sourceBlockKey?: string | null;
  form?: boolean;
  onExplain?: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const valid =
    answerType === "SHORT_TEXT" ? !!text.trim() : selected.length > 0;
  function submit() {
    if (valid && !feedback && !pending)
      onAnswer(
        answerType === "SHORT_TEXT" ? { text } : { optionIds: selected },
      );
  }
  const content = (
    <>
      <fieldset disabled={pending || !!feedback} className="min-w-0">
        <legend className="mb-2 font-semibold leading-7">{title}</legend>
        {description && (
          <p className="mb-3 text-sm leading-7 text-stone-600">{description}</p>
        )}
        <p className="mb-4 text-xs text-stone-500">{t.hints[answerType]}</p>
        {answerType === "SHORT_TEXT" ? (
          <label className="block text-sm">
            {t.yourAnswer}
            <input
              type="text"
              maxLength={1000}
              autoComplete="off"
              className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2"
              value={feedback?.chosenValues[0] ?? text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (!form && e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </label>
        ) : (
          <div className="space-y-2">
            {options.map((o) => {
              const chosen = feedback
                ? feedback.chosenValues.includes(o.text)
                : selected.includes(o.id);
              const right = feedback?.correctValues.includes(o.text);
              return (
                <label
                  key={o.id}
                  className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm leading-6 ${right ? "border-emerald-500 bg-emerald-50" : feedback && chosen ? "border-red-300 bg-red-50" : "border-stone-200 bg-white"}`}
                >
                  <input
                    type={
                      answerType === "MULTIPLE_CHOICE" ? "checkbox" : "radio"
                    }
                    name={`answer-${id}`}
                    className="mt-1 size-4 shrink-0 accent-emerald-800"
                    checked={chosen}
                    onChange={() =>
                      setSelected((current) =>
                        answerType === "SINGLE_CHOICE"
                          ? [o.id]
                          : current.includes(o.id)
                            ? current.filter((v) => v !== o.id)
                            : [...current, o.id],
                      )
                    }
                  />
                  <span className="min-w-0 break-words">{o.text}</span>
                </label>
              );
            })}
          </div>
        )}
        {!feedback && (
          <button
            type={form ? "submit" : "button"}
            onClick={form ? undefined : submit}
            className="lesson-primary mt-4"
            disabled={!valid || pending}
          >
            {pending ? "Проверяем…" : t.check}
          </button>
        )}
      </fieldset>
      {feedback && (
        <div
          role="status"
          className="mt-4 border-t border-stone-100 pt-4 text-sm leading-7"
        >
          <p
            className={
              feedback.correct
                ? "font-semibold text-emerald-800"
                : "font-semibold text-red-800"
            }
          >
            {feedback.correct ? t.correct : t.wrong}
          </p>
          <p>
            {t.yourAnswer}: {feedback.chosenValues.join("; ")}
          </p>
          {!feedback.correct && (
            <p>
              {t.correctAnswer}:{" "}
              <strong>{feedback.correctValues.join("; ")}</strong>
            </p>
          )}
          {feedback.explanation && <p>{feedback.explanation}</p>}
          {!feedback.correct && onExplain && (
            <button
              type="button"
              onClick={onExplain}
              className="mt-2 min-h-11 text-emerald-800 underline"
            >
              {tutorRu.explain}
            </button>
          )}
          {sourceBlockKey && (
            <a
              className="text-emerald-800 underline"
              href={`#b-${sourceBlockKey}`}
            >
              В методичке
            </a>
          )}
        </div>
      )}
    </>
  );
  const className =
    "min-w-0 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6";
  return form ? (
    <form
      id={`exercise-${id}`}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {content}
    </form>
  ) : (
    <div id={`exercise-${id}`} className={className}>
      {content}
    </div>
  );
}
