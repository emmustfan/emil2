"use client";
import { useState } from "react";
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
  const [options, setOptions] = useState(
    initial?.options ?? [
      { id: "a", text: "" },
      { id: "b", text: "" },
      { id: "c", text: "" },
    ],
  );
  const [correct, setCorrect] = useState(initial?.correctOptionIds[0] ?? "");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError("");
    try {
      await onSave(
        {
          stem: String(values.get("stem")),
          options,
          correctOptionIds: correct ? [correct] : [],
          explanation: String(values.get("explanation")),
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
      className="space-y-5 rounded-2xl border border-emerald-900/15 bg-white p-5"
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
            defaultValue={initial?.stem}
          />
        </label>
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium">{t.correct}</legend>
          {options.map((option, index) => (
            <div key={option.id} className="flex items-start gap-3">
              <label className="flex min-h-11 items-center gap-2 pt-2 text-sm">
                <input
                  type="radio"
                  name="correct"
                  value={option.id}
                  required
                  checked={correct === option.id}
                  onChange={() => setCorrect(option.id)}
                  className="size-5 accent-emerald-800"
                />
                <span>{index + 1}</span>
              </label>
              <label className="flex-1 text-sm">
                {t.option} {index + 1}
                <input
                  aria-label={`${t.option} ${index + 1}`}
                  className={fieldClass}
                  required
                  maxLength={1000}
                  value={option.text}
                  onChange={(e) =>
                    setOptions(
                      options.map((o) =>
                        o.id === option.id ? { ...o, text: e.target.value } : o,
                      ),
                    )
                  }
                />
              </label>
              {options.length > 3 && (
                <button
                  type="button"
                  className="mt-7 min-h-11 px-2 text-sm text-red-800 underline"
                  onClick={() => {
                    setOptions(options.filter((o) => o.id !== option.id));
                    if (correct === option.id) setCorrect("");
                  }}
                >
                  {t.removeOption}
                </button>
              )}
            </div>
          ))}
          {options.length < 5 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const id = ["a", "b", "c", "d", "e"].find(
                  (id) => !options.some((o) => o.id === id),
                )!;
                setOptions([...options, { id, text: "" }]);
              }}
            >
              {t.addOption}
            </Button>
          )}
        </fieldset>
        <label className="block text-sm font-medium">
          {t.explanation}
          <textarea
            name="explanation"
            rows={3}
            required
            maxLength={5000}
            className={fieldClass}
            defaultValue={initial?.explanation}
          />
        </label>
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
            className="size-5 accent-emerald-800"
            defaultChecked={initial?.isDiagnostic}
          />
          {t.diagnostic}
        </label>
      </fieldset>
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
