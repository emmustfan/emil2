"use client";
import { useRef } from "react";
import {
  ANSWER_TYPES,
  type Choice,
  type Definition,
  type AnswerType,
} from "@/lib/exercises";
import { exerciseRu as t } from "@/lib/exercises/ru";
const field =
  "mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm";
export function DefinitionEditor({
  value,
  onChange,
  fixedOptions,
  canonical,
}: {
  value: Definition;
  onChange: (d: Definition) => void;
  fixedOptions?: Choice[];
  canonical?: string;
}) {
  const choices = useRef(
    value.options.length
      ? value.options
      : [
          { id: "a", text: "" },
          { id: "b", text: "" },
          { id: "c", text: "" },
        ],
  );
  function type(answerType: AnswerType) {
    if (value.options.length) choices.current = value.options;
    const options = fixedOptions ?? choices.current;
    const correct = value.correctOptionIds.length
      ? value.correctOptionIds
      : [options[0].id];
    onChange({
      ...value,
      answerType,
      options: answerType === "SHORT_TEXT" ? [] : options,
      correctOptionIds:
        answerType === "SHORT_TEXT"
          ? []
          : answerType === "SINGLE_CHOICE"
            ? [correct[0]]
            : correct,
      acceptedAnswers:
        answerType === "SHORT_TEXT"
          ? [
              canonical ??
                value.acceptedAnswers[0] ??
                options.find((o) => correct.includes(o.id))?.text ??
                "",
            ]
          : [],
    });
  }
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium">
        {t.type}
        <select
          name="answerType"
          className={field}
          value={value.answerType}
          onChange={(e) => type(e.target.value as AnswerType)}
        >
          {ANSWER_TYPES.map((type) => (
            <option key={type} value={type}>
              {t.types[type]}
            </option>
          ))}
        </select>
      </label>
      {value.answerType === "SHORT_TEXT" ? (
        <>
          <label className="block text-sm font-medium">
            {t.canonical}
            <input
              className={field}
              required
              maxLength={1000}
              readOnly={canonical !== undefined}
              value={value.acceptedAnswers[0] ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  acceptedAnswers: [
                    e.target.value,
                    ...value.acceptedAnswers.slice(1),
                  ],
                })
              }
            />
          </label>
          <label className="block text-sm font-medium">
            {t.aliases}
            <textarea
              className={field}
              rows={3}
              maxLength={20000}
              value={value.acceptedAnswers.slice(1).join("\n")}
              onChange={(e) =>
                onChange({
                  ...value,
                  acceptedAnswers: [
                    value.acceptedAnswers[0] ?? "",
                    ...e.target.value.split("\n"),
                  ],
                })
              }
            />
          </label>
          <p className="text-xs leading-6 text-stone-500">
            Пробелы по краям, регистр и «ё/е» при проверке не учитываются.
            Добавляйте синонимы явно.
          </p>
        </>
      ) : (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium">Правильный ответ</legend>
          {value.options.map((o, index) => (
            <div key={o.id} className="flex items-start gap-3">
              <label className="flex min-h-11 items-center gap-2 pt-2 text-sm">
                <input
                  type={
                    value.answerType === "MULTIPLE_CHOICE"
                      ? "checkbox"
                      : "radio"
                  }
                  name="definition-correct"
                  className="size-5 accent-emerald-800"
                  checked={value.correctOptionIds.includes(o.id)}
                  disabled={
                    !!fixedOptions &&
                    (o.id === canonical || value.answerType === "SINGLE_CHOICE")
                  }
                  onChange={() =>
                    onChange({
                      ...value,
                      correctOptionIds:
                        value.answerType === "SINGLE_CHOICE"
                          ? [o.id]
                          : value.correctOptionIds.includes(o.id)
                            ? value.correctOptionIds.filter((id) => id !== o.id)
                            : [...value.correctOptionIds, o.id],
                    })
                  }
                />
                <span>{index + 1}</span>
              </label>
              <label className="min-w-0 flex-1 text-sm">
                Вариант {index + 1}
                <input
                  aria-label={`Вариант ${index + 1}`}
                  className={field}
                  required
                  readOnly={!!fixedOptions}
                  maxLength={1000}
                  value={o.text}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      options: value.options.map((option) =>
                        option.id === o.id
                          ? { ...option, text: e.target.value }
                          : option,
                      ),
                    })
                  }
                />
              </label>
              {!fixedOptions && value.options.length > 3 && (
                <button
                  type="button"
                  className="mt-7 min-h-11 px-2 text-sm text-red-800 underline"
                  onClick={() =>
                    onChange({
                      ...value,
                      options: value.options.filter(
                        (option) => option.id !== o.id,
                      ),
                      correctOptionIds: value.correctOptionIds.filter(
                        (id) => id !== o.id,
                      ),
                    })
                  }
                >
                  Убрать
                </button>
              )}
            </div>
          ))}
          {!fixedOptions && value.options.length < 5 && (
            <button
              type="button"
              className="min-h-11 rounded-lg border border-stone-300 px-4 text-sm"
              onClick={() => {
                const id = ["a", "b", "c", "d", "e"].find(
                  (id) => !value.options.some((o) => o.id === id),
                )!;
                onChange({
                  ...value,
                  options: [...value.options, { id, text: "" }],
                });
              }}
            >
              Добавить вариант
            </button>
          )}
          {value.answerType === "MULTIPLE_CHOICE" && (
            <p className="text-xs leading-6 text-stone-500">
              Отметьте не менее двух правильных вариантов. Засчитывается полный
              набор без лишних отметок.
            </p>
          )}
        </fieldset>
      )}
      <label className="block text-sm font-medium">
        {t.explanation}
        <textarea
          name="explanation"
          className={field}
          rows={3}
          maxLength={5000}
          value={value.explanation}
          onChange={(e) => onChange({ ...value, explanation: e.target.value })}
        />
      </label>
    </div>
  );
}
export function cleanDefinition(d: Definition): Definition {
  return {
    ...d,
    acceptedAnswers: d.acceptedAnswers.map((a) => a.trim()).filter(Boolean),
  };
}
