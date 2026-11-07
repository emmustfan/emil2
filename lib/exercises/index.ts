import { z } from "zod";
export const ANSWER_TYPES = [
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "SHORT_TEXT",
] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];
export type Choice = { id: string; text: string };
export type Submission = { optionIds?: string[]; text?: string };
export type Definition = {
  answerType: AnswerType;
  options: Choice[];
  correctOptionIds: string[];
  acceptedAnswers: string[];
  explanation: string;
};
export function normalizeChoice(text: string) {
  return text
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ru");
}
export function normalizeAnswer(text: string) {
  return text
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е");
}
export const gapExerciseSchema = z
  .object({
    answerType: z.enum(ANSWER_TYPES),
    correctAnswers: z
      .array(z.string().trim().min(1).max(1000))
      .max(5)
      .default([]),
    acceptedAnswers: z
      .array(z.string().trim().min(1).max(1000))
      .max(20)
      .default([]),
    explanation: z.string().trim().max(5000).default(""),
  })
  .strict();
export const gapExercisesSchema = z.record(
  z.string().regex(/^[a-f0-9]{40}$/),
  gapExerciseSchema,
);
export type GapExercise = z.infer<typeof gapExerciseSchema>;
export type GapExercises = Record<string, GapExercise>;
export function definitionErrors(d: Definition) {
  const errors: string[] = [];
  if (d.answerType === "SHORT_TEXT") {
    if (d.options.length || d.correctOptionIds.length)
      errors.push("Для ввода текста уберите варианты выбора.");
    if (
      !d.acceptedAnswers.length ||
      d.acceptedAnswers.some((a) => !normalizeAnswer(a))
    )
      errors.push("Укажите эталон текстового ответа.");
    if (
      new Set(d.acceptedAnswers.map(normalizeAnswer)).size !==
      d.acceptedAnswers.length
    )
      errors.push("Допустимые формулировки не должны повторяться.");
  } else {
    if (d.acceptedAnswers.length)
      errors.push(
        "Допустимые формулировки используются только для ввода текста.",
      );
    if (
      d.options.length < 2 ||
      d.options.length > 5 ||
      d.options.some((o) => !o.text.trim())
    )
      errors.push("Укажите от 2 до 5 непустых вариантов.");
    if (
      new Set(d.options.map((o) => o.id)).size !== d.options.length ||
      new Set(d.options.map((o) => normalizeChoice(o.text))).size !==
        d.options.length
    )
      errors.push("Варианты не должны повторяться.");
    const unique = new Set(d.correctOptionIds);
    if (
      unique.size !== d.correctOptionIds.length ||
      d.correctOptionIds.some((id) => !d.options.some((o) => o.id === id))
    )
      errors.push("Выберите правильные ответы из существующих вариантов.");
    if (d.answerType === "SINGLE_CHOICE" && d.correctOptionIds.length !== 1)
      errors.push("Выберите один правильный ответ.");
    if (d.answerType === "MULTIPLE_CHOICE" && d.correctOptionIds.length < 2)
      errors.push("Отметьте не менее двух правильных вариантов.");
  }
  return errors;
}
export function gradeAnswer(d: Definition, submission: Submission) {
  if (definitionErrors(d).length)
    throw new Error("Настройки задания некорректны.");
  const ids = submission.optionIds ?? [];
  if (d.answerType === "SHORT_TEXT") {
    if (
      ids.length ||
      typeof submission.text !== "string" ||
      !normalizeAnswer(submission.text) ||
      submission.text.length > 1000
    )
      throw new Error("Введите короткий ответ.");
    return {
      chosenValues: [submission.text.trim()],
      correctValues: [d.acceptedAnswers[0]],
      isCorrect: d.acceptedAnswers.some(
        (a) => normalizeAnswer(a) === normalizeAnswer(submission.text!),
      ),
    };
  }
  if (
    submission.text !== undefined ||
    !ids.length ||
    ids.length > 5 ||
    new Set(ids).size !== ids.length ||
    (d.answerType === "SINGLE_CHOICE" && ids.length !== 1) ||
    ids.some((id) => !d.options.some((o) => o.id === id))
  )
    throw new Error("Выберите допустимые варианты ответа.");
  return {
    chosenValues: ids.map((id) => d.options.find((o) => o.id === id)!.text),
    correctValues: d.correctOptionIds.map(
      (id) => d.options.find((o) => o.id === id)!.text,
    ),
    isCorrect:
      ids.length === d.correctOptionIds.length &&
      ids.every((id) => d.correctOptionIds.includes(id)),
  };
}
export function gapDefinition(
  gap: { answer: string; distractors: string[]; answerType?: AnswerType },
  config?: GapExercise,
): Definition {
  const answerType = config?.answerType ?? gap.answerType ?? "SINGLE_CHOICE";
  const options = [gap.answer, ...gap.distractors].map((text) => ({
    id: text,
    text,
  }));
  const requested = config?.correctAnswers.length
    ? config.correctAnswers
    : [gap.answer];
  const correct = requested.map(
    (value) =>
      options.find((o) => normalizeChoice(o.text) === normalizeChoice(value))
        ?.id ?? value,
  );
  const acceptedAnswers = [gap.answer, ...(config?.acceptedAnswers ?? [])];
  const result = {
    answerType,
    options: answerType === "SHORT_TEXT" ? [] : options,
    correctOptionIds: answerType === "SHORT_TEXT" ? [] : correct,
    acceptedAnswers: answerType === "SHORT_TEXT" ? acceptedAnswers : [],
    explanation: config?.explanation ?? "",
  };
  const errors = definitionErrors(result);
  if (config && answerType !== "SHORT_TEXT" && config.acceptedAnswers.length)
    errors.push("Формулировки используются только для текстового ответа.");
  if (config && answerType === "SHORT_TEXT" && config.correctAnswers.length)
    errors.push("Для ввода текста уберите отметки вариантов.");
  if (answerType !== "SHORT_TEXT" && !correct.includes(gap.answer))
    errors.push("Правильный ответ из текста должен оставаться отмеченным.");
  if (errors.length) throw new Error(errors.join(" "));
  return result;
}

export function createGapMarkdown(prompt: string, definition: Definition) {
  const errors = definitionErrors(definition);
  if (errors.length) throw new Error(errors.join(" "));
  if (prompt.split("____").length !== 2)
    throw new Error(
      "В тексте задания должна быть одна отметка ____ для пропуска.",
    );
  const primary =
    definition.answerType === "SHORT_TEXT"
      ? definition.acceptedAnswers[0]
      : definition.options.find((o) => o.id === definition.correctOptionIds[0])!
          .text;
  const values =
    definition.answerType === "SHORT_TEXT"
      ? [primary]
      : [
          primary,
          ...definition.options.map((o) => o.text).filter((t) => t !== primary),
        ];
  if (values.some((v) => /[\r\n|]|\[\[|\]\]/.test(v)))
    throw new Error(
      "В вариантах пропуска нельзя использовать переносы строк, |, [[ и ]].",
    );
  const markup =
    definition.answerType === "SHORT_TEXT"
      ? `[[=${primary}]]`
      : `[[${values.join("|")}]]`;
  return {
    markdown: prompt.replace("____", markup),
    config: {
      answerType: definition.answerType,
      correctAnswers:
        definition.answerType === "SHORT_TEXT"
          ? []
          : definition.correctOptionIds.map(
              (id) => definition.options.find((o) => o.id === id)!.text,
            ),
      acceptedAnswers:
        definition.answerType === "SHORT_TEXT"
          ? definition.acceptedAnswers.slice(1)
          : [],
      explanation: definition.explanation,
    },
  };
}
