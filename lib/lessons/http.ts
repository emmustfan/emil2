import { z } from "zod";
export const gapAnswerInput = z
  .object({
    optionId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    optionIds: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(5)
      .optional(),
    text: z.string().trim().min(1).max(1000).optional(),
    version: z.number().int().min(1),
    practice: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) =>
      [v.optionId, v.optionIds, v.text].filter((x) => x !== undefined)
        .length === 1,
    "Отправьте один тип ответа.",
  );
export const testStartInput = z
  .object({ version: z.number().int().min(1) })
  .strict();
export const testAnswerInput = z
  .object({
    runId: z.string().min(1).max(128),
    questionId: z.string().min(1).max(128),
    chosenId: z.string().min(1).max(128).optional(),
    optionIds: z.array(z.string().min(1).max(128)).min(1).max(5).optional(),
    text: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      [v.chosenId, v.optionIds, v.text].filter((x) => x !== undefined)
        .length === 1,
    "Отправьте один тип ответа.",
  );
