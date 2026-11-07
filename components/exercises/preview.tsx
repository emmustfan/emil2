"use client";
import { useState } from "react";
import { gradeAnswer, type Definition } from "@/lib/exercises";
import { AnswerCard, type AnswerFeedback } from "./answer-card";
export function AnswerPreview({
  definition,
  title,
  description,
  id = "preview",
}: {
  definition: Definition;
  title: string;
  description?: string;
  id?: string;
}) {
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [error, setError] = useState("");
  return (
    <div>
      <AnswerCard
        form={false}
        id={id}
        title={title}
        description={description}
        answerType={definition.answerType}
        options={definition.options}
        feedback={feedback}
        onAnswer={(input) => {
          try {
            const result = gradeAnswer(definition, input);
            setFeedback({
              correct: result.isCorrect,
              chosenValues: result.chosenValues,
              correctValues: result.correctValues,
              explanation: definition.explanation,
            });
            setError("");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Проверьте задание.");
          }
        }}
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {feedback && (
        <button
          type="button"
          className="min-h-11 text-sm text-emerald-800 underline"
          onClick={() => setFeedback(null)}
        >
          Попробовать ещё раз
        </button>
      )}
    </div>
  );
}
