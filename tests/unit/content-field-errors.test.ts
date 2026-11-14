import { expect, it, vi, afterEach } from "vitest";
import { topicFields, questionFields } from "../../lib/content/validation";
import { contentFieldIssues } from "../../lib/content/field-errors";
import { contentFailure } from "../../lib/content/http";
import {
  requestContent,
  EditorRequestError,
} from "../../components/admin/helpers";
import { lessonReadiness } from "../../lib/content/readiness";
import { parseTopic } from "../../lib/content/parse";
const form = {
  title: "Урок",
  slug: "lesson",
  sectionId: null,
  order: 0,
  isFree: true,
  contentMd: "Текст [[ответ|нет]].",
  readingMinutes: null,
  authorName: "Автор",
  reviewerName: null,
  referencesMd: null,
  reviewed: false,
};
afterEach(() => vi.unstubAllGlobals());
it("returns named Russian fields and constraints instead of an opaque validation error", async () => {
  const result = topicFields.safeParse({
    ...form,
    title: " ",
    slug: "Плохой адрес",
    readingMinutes: 0,
  });
  if (result.success) throw new Error("Expected validation failure");
  const response = contentFailure(result.error),
    data = await response.json();
  expect(response.status).toBe(422);
  expect(data.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "title",
        label: "Название",
        message: "Заполните это поле.",
        target: "lesson-field-title",
      }),
      expect.objectContaining({
        path: "slug",
        label: "Адрес урока (Slug)",
        message: expect.stringContaining("латинские"),
      }),
      expect.objectContaining({
        path: "readingMinutes",
        label: "Время чтения, мин.",
        message: "Значение должно быть не меньше 1.",
      }),
    ]),
  );
  expect(data.error).not.toContain("Проверьте заполненные поля");
  expect(data.error).not.toMatch(/Too small|Invalid input/);
});
it("keeps the question identity and points to the specific saved question", () => {
  const result = questionFields.safeParse({
    answerType: "SINGLE_CHOICE",
    stem: "Вопрос",
    options: [
      { id: "a", text: "А" },
      { id: "b", text: "Б" },
      { id: "c", text: "В" },
    ],
    correctOptionIds: ["a"],
    explanation: "",
    sourceBlockKey: null,
    isDiagnostic: false,
    order: 0,
  });
  if (result.success) throw new Error("Expected validation failure");
  expect(
    contentFieldIssues(result.error.issues, { id: "question-2", number: 2 }),
  ).toEqual([
    expect.objectContaining({
      path: "questions.1.explanation",
      label: "Вопрос 2 — Объяснение ответа",
      questionId: "question-2",
      target: "lesson-question-question-2",
    }),
  ]);
});
it("preserves server field details in the editor request error", async () => {
  const fields = [
    {
      path: "slug",
      label: "Адрес урока (Slug)",
      message: "Используйте латинские буквы.",
      target: "lesson-field-slug",
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Исправьте адрес", fields }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
  const failure = await requestContent("topics/example", "PATCH", {}).catch(
    (error) => error,
  );
  expect(failure).toBeInstanceOf(EditorRequestError);
  if (!(failure instanceof EditorRequestError)) throw failure;
  expect(failure.fields).toEqual(fields);
});
it("readiness lists the actual missing fields and explains an empty lesson", () => {
  const checks = lessonReadiness(
    { ...form, contentMd: "" },
    parseTopic(""),
    [],
    {
      minQuestions: 5,
      maxQuestions: 15,
      subjectPublished: false,
      status: "DRAFT",
      imageIds: [],
      previewCurrent: true,
    },
  );
  expect(checks.find((c) => c.id === "text")?.note).toBe(
    "Напишите текст методички.",
  );
  expect(checks.find((c) => c.id === "sources")?.note).toBe(
    "Заполните: Рецензент, Источники.",
  );
  expect(checks.find((c) => c.id === "questions")?.note).toContain(
    "Добавьте ещё 5",
  );
});
