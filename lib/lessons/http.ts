import { z } from "zod";
export const gapAnswerInput = z
  .object({
    optionId: z.string().regex(/^[a-f0-9]{64}$/),
    version: z.number().int().min(1),
    practice: z.boolean().default(false),
  })
  .strict();
export const testStartInput = z
  .object({ version: z.number().int().min(1) })
  .strict();
export const testAnswerInput = z
  .object({
    runId: z.string().min(1).max(128),
    questionId: z.string().min(1).max(128),
    chosenId: z.string().min(1).max(128),
  })
  .strict();
