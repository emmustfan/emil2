import type { ZodIssue } from "zod";
export type ContentFieldIssue = {
  path: string;
  label: string;
  message: string;
  target: string;
  questionId?: string;
};
const names: Record<string, string> = {
  title: "Название",
  slug: "Адрес урока (Slug)",
  shortDescription: "Краткое описание",
  readingMinutes: "Время чтения, мин.",
  order: "Порядок",
  sectionId: "Раздел",
  authorName: "Автор",
  reviewerName: "Рецензент",
  referencesMd: "Источники",
  reviewed: "Проверка экспертом",
  contentMd: "Текст методички",
  gapExercises: "Настройки пропуска",
  isFree: "Бесплатный доступ",
  stem: "Текст вопроса",
  explanation: "Объяснение ответа",
  options: "Варианты ответа",
  correctOptionIds: "Правильные ответы",
  acceptedAnswers: "Допустимые формулировки",
  sourceBlockKey: "Блок-источник вопроса",
  answerType: "Тип задания",
  revision: "Версия урока",
  subject: "Статус предмета",
  status: "Статус урока",
  questions: "Тест по теме",
};
export function fieldIssue(path: string, message: string): ContentFieldIssue {
  const root = path.split(".")[0];
  const target =
    root === "questions"
      ? "lesson-questions"
      : ["contentMd", "gapExercises"].includes(root)
        ? "lesson-text"
        : [
              "stem",
              "options",
              "explanation",
              "correctOptionIds",
              "acceptedAnswers",
              "sourceBlockKey",
              "answerType",
            ].includes(root)
          ? "lesson-question-form"
          : root === "subject"
            ? "lesson-subject-settings"
            : root === "status"
              ? "lesson-review"
              : root
                ? `lesson-field-${root}`
                : "lesson-editor-status";
  return { path, label: names[root] ?? "Данные урока", message, target };
}
function russianMessage(issue: ZodIssue) {
  if (/[а-яё]/i.test(issue.message)) return issue.message;
  if (issue.path[0] === "options" && issue.path.at(-1) === "id")
    return "Удалите и добавьте этот вариант заново: его служебный идентификатор некорректен.";
  if (issue.code === "too_small") {
    if (issue.origin === "string")
      return issue.minimum === 1
        ? "Заполните это поле."
        : `Введите не меньше ${issue.minimum} символов.`;
    if (issue.origin === "array")
      return `Добавьте не меньше ${issue.minimum} элементов.`;
    return `Значение должно быть не меньше ${issue.minimum}.`;
  }
  if (issue.code === "too_big") {
    if (issue.origin === "string")
      return `Допускается не больше ${issue.maximum} символов.`;
    if (issue.origin === "array")
      return `Допускается не больше ${issue.maximum} элементов.`;
    return `Значение должно быть не больше ${issue.maximum}.`;
  }
  if (issue.code === "invalid_type")
    return issue.expected === "number" || issue.expected === "int"
      ? "Укажите целое число."
      : "Заполните поле в указанном формате.";
  if (issue.code === "unrecognized_keys")
    return "Обновите страницу: передан неподдерживаемый параметр.";
  if (issue.code === "invalid_value") return "Выберите допустимое значение.";
  return "Проверьте значение этого поля.";
}
export function contentFieldIssues(
  issues: readonly ZodIssue[],
  question?: { id: string; number: number },
): ContentFieldIssue[] {
  return issues.map((issue) => {
    const path = issue.path.map(String).join("."),
      field = fieldIssue(path, russianMessage(issue));
    const index =
      issue.path[0] === "options" && typeof issue.path[1] === "number"
        ? issue.path[1] + 1
        : null;
    if (index) field.label = `Вариант ответа ${index}`;
    if (question)
      return {
        ...field,
        path: `questions.${question.number - 1}.${path}`,
        label: `Вопрос ${question.number}${path ? ` — ${field.label}` : ""}`,
        target: `lesson-question-${question.id}`,
        questionId: question.id,
      };
    return field;
  });
}
export function contentFieldSummary(fields: ContentFieldIssue[]) {
  return fields.map((f) => `${f.label}: ${f.message}`).join(" ");
}
