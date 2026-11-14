"use client";
import { useState } from "react";
import type { LessonGap } from "@/lib/lessons/types";
import type { AnswerFeedback } from "./answer-card";
import type { Submission } from "@/lib/exercises";
export function InlineGap({
  gap,
  number,
  pending,
  onAnswer,
  onExplain,
}: {
  gap: Pick<LessonGap, "id" | "answerType" | "options"> & {
    feedback: AnswerFeedback | null;
  };
  number: number;
  pending: boolean;
  onAnswer: (submission: Submission) => void;
  onExplain?: () => void;
}) {
  const [value, setValue] = useState(""),
    [expanded, setExpanded] = useState(false);
  const feedback = gap.feedback,
    text = gap.answerType === "SHORT_TEXT";
  const chosen = feedback
    ? ((text
        ? feedback.chosenValues[0]
        : gap.options.find((o) => feedback.chosenValues.includes(o.text))
            ?.id) ?? "")
    : value;
  const submit = () => {
    if (value.trim() && !pending && !feedback)
      onAnswer(text ? { text: value } : { optionIds: [value] });
  };
  return (
    <span
      id={`exercise-${gap.id}`}
      role="group"
      aria-label={`Пропуск ${number}`}
      className={`inline-gap ${feedback ? (feedback.correct ? "is-correct" : "is-wrong") : ""}`}
    >
      {text ? (
        <input
          aria-label="Ваш ответ"
          value={chosen}
          maxLength={1000}
          disabled={pending || !!feedback}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ваш ответ"
        />
      ) : (
        <select
          aria-label={`Пропуск ${number}: выберите слово`}
          value={chosen}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending || !!feedback}
        >
          <option value="" disabled>
            Выберите слово…
          </option>
          {gap.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.text}
            </option>
          ))}
        </select>
      )}
      {!feedback ? (
        <button
          type="button"
          disabled={!value.trim() || pending}
          onClick={submit}
          aria-label="Проверить"
          title="Проверить"
        >
          {pending ? "…" : "✓"}
        </button>
      ) : (
        <>
          <span role="status" className="inline-gap-status">
            {feedback.correct ? "Верно" : "Неверно"}
          </span>
          <button
            type="button"
            className="inline-gap-info"
            aria-expanded={expanded}
            aria-controls={`gap-note-${gap.id}`}
            aria-label={`Пояснение к пропуску ${number}`}
            onClick={() => setExpanded((v) => !v)}
          >
            ?
          </button>
          <span
            id={`gap-note-${gap.id}`}
            hidden={!expanded}
            className="inline-gap-note"
          >
            {!feedback.correct && (
              <>
                Правильный ответ:{" "}
                <strong>{feedback.correctValues.join(", ")}</strong>.{" "}
              </>
            )}
            {feedback.explanation}
          </span>
          {!feedback.correct && onExplain && (
            <button type="button" onClick={onExplain}>
              Объяснить · ИИ
            </button>
          )}
        </>
      )}
    </span>
  );
}
