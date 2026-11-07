"use client";
import { useState } from "react";
import {
  createGapMarkdown,
  type Definition,
  type GapExercise,
} from "@/lib/exercises";
import {
  DefinitionEditor,
  cleanDefinition,
} from "@/components/exercises/definition-editor";
import { AnswerPreview } from "@/components/exercises/preview";
export function GapInsertForm({
  busy,
  onInsert,
}: {
  busy: boolean;
  onInsert: (markdown: string, config: GapExercise) => Promise<void>;
}) {
  const [value, setValue] = useState<Definition>({
    answerType: "SINGLE_CHOICE",
    options: [
      { id: "a", text: "" },
      { id: "b", text: "" },
      { id: "c", text: "" },
    ],
    correctOptionIds: [],
    acceptedAnswers: [],
    explanation: "",
  });
  const [prompt, setPrompt] = useState("Вставьте ответ: ____.");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <details className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
      <summary className="min-h-11 cursor-pointer font-semibold">
        Добавить задание в методичку
      </summary>
      <form
        className="mt-4 space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError("");
          try {
            const result = createGapMarkdown(prompt, cleanDefinition(value));
            await onInsert(result.markdown, result.config);
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Не удалось добавить задание.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <fieldset disabled={busy || pending} className="space-y-4">
          <label className="block text-sm font-medium">
            Текст вокруг пропуска
            <textarea
              className="mt-2 w-full rounded-lg border border-stone-300 bg-white p-3 text-sm"
              value={prompt}
              maxLength={3000}
              required
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          <p className="text-xs text-stone-600">
            Поставьте ____ в месте ответа. Задание добавится в конец методички;
            текст затем можно переместить.
          </p>
          <DefinitionEditor value={value} onChange={setValue} />
          <button className="lesson-primary" disabled={busy || pending}>
            Вставить задание
          </button>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-red-800">
            {error}
          </p>
        )}
        <AnswerPreview
          key={JSON.stringify(value) + prompt}
          title="Новое задание"
          description={prompt}
          id="new-gap"
          definition={cleanDefinition(value)}
        />
      </form>
    </details>
  );
}
