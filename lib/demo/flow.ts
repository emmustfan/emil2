import { z } from "zod";
export const flowSchema = z.object({
  skip: z.boolean().default(false),
  topicId: z.string().optional(),
  runId: z.string().optional(),
  questions: z
    .array(
      z.object({
        id: z.string(),
        topicId: z.string(),
        version: z.number().int(),
      }),
    )
    .default([]),
  cardIds: z.array(z.string()).max(3).default([]),
  revealed: z.array(z.string()).max(3).default([]),
  rated: z.array(z.string()).max(3).default([]),
});
export type Flow = z.infer<typeof flowSchema>;
export function readFlow(value: unknown): Flow {
  return flowSchema.parse(value ?? {});
}
export const submissionSchema = z
  .object({
    optionIds: z.array(z.string().max(200)).min(1).max(5).optional(),
    text: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("goal"),
      goal: z.enum(["debt", "session", "gia", "understand", "other", "skip"]),
      text: z.string().trim().max(200).optional(),
    })
    .strict(),
  z
    .object({ action: z.literal("subject"), subjectId: z.string().max(100) })
    .strict(),
  z
    .object({
      action: z.literal("answer"),
      questionId: z.string().max(100),
      submission: submissionSchema,
    })
    .strict(),
  z.object({ action: z.literal("lesson") }).strict(),
  z.object({ action: z.literal("review") }).strict(),
  z
    .object({ action: z.literal("reveal"), cardId: z.string().max(100) })
    .strict(),
  z
    .object({
      action: z.literal("rate"),
      cardId: z.string().max(100),
      rating: z.enum(["HARD", "GOOD", "EASY"]),
    })
    .strict(),
  z.object({ action: z.literal("finish") }).strict(),
]);
export type DemoAction = z.infer<typeof actionSchema>;
export function diagnosticSummary(
  answers: { topicId: string; isCorrect: boolean }[],
) {
  return {
    correct: answers.filter((a) => a.isCorrect).length,
    strongTopicIds: answers.filter((a) => a.isCorrect).map((a) => a.topicId),
    weakTopicIds: answers.filter((a) => !a.isCorrect).map((a) => a.topicId),
  };
}
