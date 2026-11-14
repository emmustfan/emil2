import { z } from "zod";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const common = { requestId: z.uuid(), conversationId: id.optional() };
export const tutorInput = z.discriminatedUnion("kind", [
  z
    .object({
      ...common,
      kind: z.literal("question"),
      text: z.string().trim().min(1).max(1000),
      subjectId: id.optional(),
      topicId: id.optional(),
    })
    .strict()
    .refine((v) => !!v.subjectId || !!v.topicId, "Выберите предмет или тему."),
  z
    .object({
      ...common,
      kind: z.literal("explain"),
      source: z.enum(["GAP", "QUESTION"]),
      sourceId: id,
      topicVersion: z.number().int().positive(),
      runId: id.optional(),
    })
    .strict(),
]);
export type TutorInput = z.infer<typeof tutorInput>;
export type ExplainInput = Omit<
  Extract<TutorInput, { kind: "explain" }>,
  "requestId" | "conversationId"
>;
export type Quota = {
  remaining: number;
  limit: number;
  resetAt: string | null;
  tier: "guest" | "free" | "paid";
  timeZone: string;
};
export type Citation = {
  n: number;
  topicId: string;
  topicVersion: number;
  blockKey: string;
  heading: string | null;
  topicTitle: string;
  href: string;
};
export type Source = Citation & { text: string };
export type TutorReply = {
  id: string;
  content: string;
  citations: Citation[];
  feedback: number | null;
};
export type TutorEvent =
  | { type: "start"; conversationId: string; quota: Quota }
  | { type: "delta"; text: string }
  | { type: "done"; message: TutorReply; quota: Quota }
  | { type: "error"; error: string; quota?: Quota };
