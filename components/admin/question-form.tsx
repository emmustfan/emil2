"use client";
import { useState } from "react";
import {
  DefinitionEditor,
  cleanDefinition,
} from "@/components/exercises/definition-editor";
import { AnswerPreview } from "@/components/exercises/preview";
import type { Definition } from "@/lib/exercises";
import { Button } from "@/components/ui/button";
import { contentRu as t } from "@/lib/i18n/ru";
import type { QuestionDTO } from "@/lib/content/types";
import type { QuestionInput } from "@/lib/content/validation";
import type { ParsedBlock } from "@/lib/content/parse";
import { fieldClass } from "./helpers";
export function QuestionForm({
  initial,
  blocks,
  busy,
  onSave,
  onCancel,
}: {
  initial?: QuestionDTO;
  blocks: ParsedBlock[];
  busy: boolean;
  onSave: (input: QuestionInput, id?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [definition, setDefinition] = useState<Definition>({
    answerType: initial?.answerType ?? "SINGLE_CHOICE",
    options: initial?.options ?? [
      { id: "a", text: "" },
      { id: "b", text: "" },
      { id: "c", text: "" },
    ],
    correctOptionIds: initial?.correctOptionIds ?? [],
    acceptedAnswers: initial?.acceptedAnswers ?? [],
    explanation: initial?.explanation ?? "",
  });
  const [stem, setStem] = useState(initial?.stem ?? "");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError("");
    try {
      await onSave(
        {
          stem: String(values.get("stem")),
          ...cleanDefinition(definition),
          sourceBlockKey: String(values.get("sourceBlockKey")) || null,
          isDiagnostic: values.get("isDiagnostic") === "on",
          order: Number(values.get("order")),
        },
        initial?.id,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t.error);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="book-question-form space-y-4 rounded-2xl border border-emerald-900/15 bg-white p-5"
    >
      <h3 className="text-lg font-semibold">
        {initial ? t.editQuestion : t.newQuestion}
      </h3>
      <p className="text-xs leading-6 text-stone-500">{t.questionNote}</p>
      <fieldset disabled={busy} className="space-y-5">
        <label className="block text-sm font-medium">
          {t.stem}
          <textarea
            name="stem"
            className={fieldClass}
            required
            maxLength={3000}
            value={stem}
            onChange={(e) => setStem(e.target.value)}
          />
        </label>
        <DefinitionEditor value={definition} onChange={setDefinition} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            {t.source}
            <select
              name="sourceBlockKey"
              className={fieldClass}
              defaultValue={
                initial?.sourceBlockKey ??
                blocks.find((b) => b.kind !== "heading")?.blockKey ??
                ""
              }
            >
              <option value="">{t.noSource}</option>
              {blocks.map((b) => (
                <option key={b.blockKey} value={b.blockKey}>
                  {b.heading ?? t.blocks} · {b.text.slice(0, 100)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            {t.order}
            <input
              name="order"
              type="number"
              min={0}
              max={10000}
              className={fieldClass}
              defaultValue={initial?.order ?? 0}
            />
          </label>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="isDiagnostic"
            aria-describedby="question-demo-hint"
            className="book-switch"
            defaultChecked={initial?.isDiagnostic}
          />
          {t.diagnostic}
        </label>
        <p id="question-demo-hint" className="text-xs leading-6 text-stone-500">
          Включает вопрос в диагностику демо после проверки и публикации. Для
          полного демо предмету нужны три опубликованных урока с такими
          вопросами и хотя бы один бесплатный урок.
        </p>
      </fieldset>
      <section
        className="border-t border-stone-200 pt-5"
        aria-label="Предпросмотр задания"
      >
        <h4 className="mb-3 text-sm font-semibold">Предпросмотр задания</h4>
        <AnswerPreview
          key={JSON.stringify(definition) + stem}
          id={`question-preview-${initial?.id ?? "new"}`}
          title={stem || "Текст вопроса"}
          definition={cleanDefinition(definition)}
        />
      </section>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy}>{t.saveQuestion}</Button>
        {initial && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onCancel}
          >
            {t.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}
