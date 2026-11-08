import type { ParsedTopic } from "./parse";
import type { TopicInput } from "./validation";
import { questionFields } from "./validation";
import type { QuestionDTO } from "./types";
import { gapDefinition } from "../exercises";
export function lessonReadiness(
  form: TopicInput,
  parsed: ParsedTopic,
  questions: QuestionDTO[],
  options: {
    minQuestions: number;
    maxQuestions: number;
    subjectPublished: boolean;
    status: string;
    imageIds: string[];
    previewCurrent: boolean;
  },
) {
  const definitions = parsed.gaps.every((g) => {
    try {
      gapDefinition(g, form.gapExercises?.[g.gapKey]);
      return true;
    } catch {
      return false;
    }
  });
  const validQuestions = questions.every(
    (q) =>
      questionFields.safeParse({
        answerType: q.answerType,
        acceptedAnswers: q.acceptedAnswers,
        stem: q.stem,
        options: q.options,
        correctOptionIds: q.correctOptionIds,
        explanation: q.explanation,
        sourceBlockKey: q.sourceBlockKey,
        isDiagnostic: q.isDiagnostic,
        order: q.order,
      }).success &&
      (!q.sourceBlockKey ||
        parsed.blocks.some((b) => b.blockKey === q.sourceBlockKey)),
  );
  return [
    {
      id: "text",
      target: "lesson-text",
      label: "Текст и разметка",
      ok:
        !!form.contentMd.trim() &&
        !parsed.errors.length &&
        options.previewCurrent,
      note: options.previewCurrent
        ? `${parsed.errors.length} ошибок разметки`
        : "Предпросмотр обновляется",
    },
    {
      id: "gaps",
      target: "lesson-exercises",
      label: "Задания в методичке",
      ok: parsed.gaps.length > 0 && definitions,
      note: `Добавлено: ${parsed.gaps.length}`,
    },
    {
      id: "images",
      target: "lesson-text",
      label: "Изображения относятся к этой теме",
      ok: parsed.images.every((i) => options.imageIds.includes(i.id)),
      note: `Изображений в тексте: ${parsed.images.length}`,
    },
    {
      id: "questions",
      target: "lesson-questions",
      label: "Вопросы теста и правильные ответы",
      ok:
        questions.length >= options.minQuestions &&
        questions.length <= options.maxQuestions &&
        validQuestions,
      note: `${questions.length} из ${options.minQuestions}–${options.maxQuestions}; объяснения и источники проверяются`,
    },
    {
      id: "sources",
      target: "lesson-review",
      label: "Автор, рецензент и источники",
      ok:
        !!form.authorName?.trim() &&
        !!form.reviewerName?.trim() &&
        !!form.referencesMd?.trim(),
      note: "Заполните три поля выше",
    },
    {
      id: "expert",
      target: "lesson-review",
      label: "Эксперт подтвердил содержание",
      ok: !!form.reviewed,
      note: "Отметка ставится после ручной проверки",
    },
    {
      id: "subject",
      target: "lesson-basics",
      label: "Предмет опубликован",
      ok: options.subjectPublished,
      note: "Настраивается на странице предмета",
    },
    {
      id: "status",
      target: "lesson-review",
      label: "Тема отправлена на проверку",
      ok: ["REVIEW", "PUBLISHED"].includes(options.status),
      note: "Нажмите «Отправить на проверку» перед публикацией",
    },
  ];
}
