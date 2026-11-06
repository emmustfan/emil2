import { z } from "zod";
import { MAX_MARKDOWN_CHARS } from "./parse";
export const revisionSchema = z.number().int().nonnegative();
const slug = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Используйте латинские буквы, цифры и дефис.",
  );
export const subjectFields = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug,
    shortDescription: z.string().trim().min(1).max(1000),
    descriptionMd: z.string().max(20000).nullable().default(null),
    courses: z
      .array(z.number().int().min(1).max(6))
      .max(6)
      .refine((v) => new Set(v).size === v.length),
    order: z.number().int().min(0).max(10000),
    status: z.enum(["DRAFT", "REVIEW", "PUBLISHED"]),
    seoTitle: z.string().max(200).nullable().default(null),
    seoDescription: z.string().max(500).nullable().default(null),
  })
  .strict();
export const sectionFields = z
  .object({
    title: z.string().trim().min(1).max(200),
    order: z.number().int().min(0).max(10000),
  })
  .strict();
export const topicFields = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug,
    sectionId: z.string().max(100).nullable(),
    order: z.number().int().min(0).max(10000),
    isFree: z.boolean(),
    contentMd: z.string().max(MAX_MARKDOWN_CHARS),
    readingMinutes: z.number().int().min(1).max(600).nullable().default(null),
    authorName: z.string().trim().max(200).nullable().default(null),
    reviewerName: z.string().trim().max(200).nullable().default(null),
    referencesMd: z.string().trim().max(20000).nullable().default(null),
    reviewed: z.boolean().default(false),
  })
  .strict();
export const questionFields = z
  .object({
    stem: z.string().trim().min(1).max(3000),
    options: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
            text: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .min(3)
      .max(5),
    correctOptionIds: z.array(z.string()).length(1),
    explanation: z.string().trim().min(1).max(5000),
    sourceBlockKey: z.string().max(200).nullable(),
    isDiagnostic: z.boolean(),
    order: z.number().int().min(0).max(10000),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (
      new Set(q.options.map((o) => o.id)).size !== q.options.length ||
      new Set(q.options.map((o) => o.text.toLocaleLowerCase("ru"))).size !==
        q.options.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Варианты не должны повторяться.",
      });
    if (!q.options.some((o) => o.id === q.correctOptionIds[0]))
      ctx.addIssue({
        code: "custom",
        path: ["correctOptionIds"],
        message: "Выберите один правильный ответ из вариантов.",
      });
  });
export const listSchema = z.object({
  q: z.string().max(200).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export type SubjectInput = z.infer<typeof subjectFields>;
export type SectionInput = z.infer<typeof sectionFields>;
export type TopicInput = z.infer<typeof topicFields>;
export type QuestionInput = z.infer<typeof questionFields>;
