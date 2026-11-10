"use client";
import { useState } from "react";
import {
  AnswerCard,
  type AnswerFeedback,
} from "@/components/exercises/answer-card";
import type { publicExamples } from "@/lib/landing/content";
export function HeroExample({
  example,
}: {
  example: ReturnType<typeof publicExamples>[number];
}) {
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="hero-sample">
      <p>
        <span>Первые шаги в уроке</span>
        <span className="emal-pill">Попробуйте прямо здесь</span>
      </p>
      <AnswerCard
        id={`hero-${example.id}`}
        title={example.stem}
        answerType={example.answerType}
        options={example.options}
        feedback={feedback}
        pending={busy}
        onAnswer={async (submission) => {
          setBusy(true);
          setError("");
          try {
            const r = await fetch("/api/landing-example", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "answer",
                id: example.id,
                submission,
              }),
            });
            const result = await r.json();
            if (!r.ok) throw new Error(result.error);
            setFeedback(result);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Попробуйте ещё раз.");
          } finally {
            setBusy(false);
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
      <div className="mt-5 border-t border-stone-200 pt-4 text-xs emal-muted">
        Выберите ответ и проверьте себя. В уроках ошибки станут карточками для
        повторения.
      </div>
    </div>
  );
}
