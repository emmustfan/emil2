import type { ParsedTopic } from "./parse";
import type { TopicInput } from "./validation";
import { questionFields } from "./validation";
import type { QuestionDTO } from "./types";
import { gapDefinition } from "../exercises";
import { contentFieldIssues, contentFieldSummary } from "./field-errors";
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
  const gapProblems = parsed.gaps.flatMap((g) => {
    try {
      gapDefinition(g, form.gapExercises?.[g.gapKey]);
      return [];
    } catch (e) {
      return [
        `Пропуск ${g.order + 1}: ${e instanceof Error ? e.message : "проверьте ответы"}`,
      ];
    }
  });
  const questionProblems = questions.flatMap((q, index) => {
    const validation = questionFields.safeParse({
      answerType: q.answerType,
      acceptedAnswers: q.acceptedAnswers,
      stem: q.stem,
      options: q.options,
      correctOptionIds: q.correctOptionIds,
      explanation: q.explanation,
      sourceBlockKey: q.sourceBlockKey,
      isDiagnostic: q.isDiagnostic,
      order: q.order,
    });
    if (!validation.success)
      return [
        contentFieldSummary(
          contentFieldIssues(validation.error.issues, {
            id: q.id,
            number: index + 1,
          }),
        ),
      ];
    if (
      q.sourceBlockKey &&
      !parsed.blocks.some((b) => b.blockKey === q.sourceBlockKey)
    )
      return [`Вопрос ${index + 1}: выберите блок-источник заново.`];
    return [];
  });
  const missingSources = [
    !form.authorName?.trim() ? "Автор" : null,
    !form.reviewerName?.trim() ? "Рецензент" : null,
    !form.referencesMd?.trim() ? "Источники" : null,
  ].filter(Boolean);
  return [
    {
      id: "text",
      target: "lesson-text",
      label: "Текст и разметка",
      ok:
        !!form.contentMd.trim() &&
        !parsed.errors.length &&
        options.previewCurrent,
      note: !form.contentMd.trim()
        ? "Напишите текст методички."
        : options.previewCurrent
          ? `${parsed.errors.length} ошибок разметки`
          : "Предпросмотр обновляется",
    },
    {
      id: "gaps",
      target: "lesson-text",
      label: "Пропуски в тексте",
      ok: parsed.gaps.length > 0 && !gapProblems.length,
      note: !parsed.gaps.length
        ? "Выделите слово в тексте и нажмите «Пропуск»."
        : gapProblems.length
          ? gapProblems.join(" ")
          : `Добавлено: ${parsed.gaps.length}. Настройки заполнены.`,
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
        !questionProblems.length,
      note:
        questions.length < options.minQuestions
          ? `Сохранено ${questions.length}. Добавьте ещё ${options.minQuestions - questions.length} вопросов; нужно от ${options.minQuestions} до ${options.maxQuestions}.`
          : questions.length > options.maxQuestions
            ? `Сохранено ${questions.length}. Уберите ${questions.length - options.maxQuestions} вопросов; максимум ${options.maxQuestions}.`
            : questionProblems.length
              ? questionProblems.join(" ")
              : `Сохранено ${questions.length} вопросов. Ответы и объяснения заполнены.`,
    },
    {
      id: "sources",
      target: "lesson-review",
      label: "Автор, рецензент и источники",
      ok:
        !!form.authorName?.trim() &&
        !!form.reviewerName?.trim() &&
        !!form.referencesMd?.trim(),
      note: missingSources.length
        ? `Заполните: ${missingSources.join(", ")}.`
        : "Автор, рецензент и источники указаны.",
    },
    {
      id: "expert",
      target: "lesson-review",
      label: "Эксперт подтвердил содержание",
      ok: !!form.reviewed,
      note: form.reviewed
        ? "Проверка подтверждена."
        : "После проверки содержания отметьте «Проверено экспертом».",
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
