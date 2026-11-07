"use client";
import { useState } from "react";
import type { ParsedGap } from "@/lib/content/parse";
import {
  gapDefinition,
  type Definition,
  type GapExercise,
  type GapExercises,
} from "@/lib/exercises";
import {
  DefinitionEditor,
  cleanDefinition,
} from "@/components/exercises/definition-editor";
import { AnswerPreview } from "@/components/exercises/preview";
function draft(gap: ParsedGap, config?: GapExercise): Definition {
  try {
    return gapDefinition(gap, config);
  } catch {
    return {
      answerType: config?.answerType ?? gap.answerType,
      options:
        config?.answerType === "SHORT_TEXT"
          ? []
          : [gap.answer, ...gap.distractors].map((text) => ({
              id: text,
              text,
            })),
      correctOptionIds: config?.correctAnswers.length
        ? config.correctAnswers
        : [gap.answer],
      acceptedAnswers:
        config?.answerType === "SHORT_TEXT"
          ? [gap.answer, ...config.acceptedAnswers]
          : [],
      explanation: config?.explanation ?? "",
    };
  }
}
function GapForm({
  gap,
  config,
  index,
  busy,
  onSave,
}: {
  gap: ParsedGap;
  config?: GapExercise;
  index: number;
  busy: boolean;
  onSave: (config: GapExercise) => void;
}) {
  const [value, setValue] = useState(() => draft(gap, config));
  const [saved, setSaved] = useState(false);
  const options = [gap.answer, ...gap.distractors].map((text) => ({
    id: text,
    text,
  }));
  return (
    <details className="rounded-xl border border-stone-200 bg-white p-5">
      <summary className="min-h-11 cursor-pointer text-sm font-semibold">
        Пропуск {index + 1}: {gap.sentence}
      </summary>
      <div className="mt-4 grid min-w-0 gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <fieldset disabled={busy}>
            <DefinitionEditor
              value={value}
              fixedOptions={options}
              canonical={gap.answer}
              onChange={(d) => {
                setValue(d);
                setSaved(false);
              }}
            />
          </fieldset>
          <button
            type="button"
            disabled={busy}
            className="lesson-primary mt-4"
            onClick={() => {
              const d = cleanDefinition(value);
              onSave({
                answerType: d.answerType,
                correctAnswers:
                  d.answerType === "SHORT_TEXT" ? [] : d.correctOptionIds,
                acceptedAnswers:
                  d.answerType === "SHORT_TEXT"
                    ? d.acceptedAnswers.slice(1)
                    : [],
                explanation: d.explanation,
              });
              setSaved(true);
            }}
          >
            Сохранить настройки пропуска
          </button>
          {saved && (
            <p role="status" className="mt-2 text-sm text-emerald-800">
              Настройки добавлены в черновик.
            </p>
          )}
          <p className="mt-3 text-xs leading-6 text-stone-500">
            Эталон и варианты берутся из методички. Меняйте их в тексте; здесь
            выбираются тип проверки, дополнительные правильные варианты и
            объяснение.
          </p>
        </div>
        <div className="min-w-0">
          <p className="mb-3 text-sm font-semibold">Предпросмотр задания</p>
          <AnswerPreview
            key={JSON.stringify(value)}
            id={`gap-preview-${gap.gapKey}`}
            title={`Пропуск ${index + 1}`}
            description={gap.sentence}
            definition={cleanDefinition(value)}
          />
        </div>
      </div>
    </details>
  );
}
export function GapExercisesEditor({
  gaps,
  configs,
  busy,
  onChange,
}: {
  gaps: ParsedGap[];
  configs: GapExercises;
  busy: boolean;
  onChange: (configs: GapExercises) => void;
}) {
  return (
    <section className="space-y-4 border-t border-stone-200 pt-7">
      <h2 className="text-2xl font-semibold">
        Задания в методичке · {gaps.length}
      </h2>
      <p className="text-sm leading-7 text-stone-600">
        Откройте пропуск, выберите тип ответа и проверьте его в предпросмотре.
        Для нового текстового пропуска используйте <code>[[=эталон]]</code>.
      </p>
      {gaps.map((gap, index) => (
        <GapForm
          key={gap.gapKey + gap.answer + gap.distractors.join("|")}
          gap={gap}
          index={index}
          config={configs[gap.gapKey]}
          busy={busy}
          onSave={(config) => onChange({ ...configs, [gap.gapKey]: config })}
        />
      ))}
    </section>
  );
}
