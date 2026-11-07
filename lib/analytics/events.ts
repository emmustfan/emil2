import { touchSchema } from "./identity";
import type { Prisma } from "../generated/prisma/client";
import { getDb } from "../db";
import type { Actor } from "../lessons/types";
import { z } from "zod";
export const eventSchemas = {
  landing_viewed: z.object({ utm: touchSchema.optional() }).strict(),
  demo_started: z.object({ source: z.enum(["landing", "direct"]) }).strict(),
  demo_goal_selected: z
    .object({
      goal: z.enum(["debt", "session", "gia", "understand", "other", "skip"]),
    })
    .strict(),
  demo_subject_selected: z.object({ subjectId: z.string().max(100) }).strict(),
  diagnostic_completed: z
    .object({ correct: z.number().int().min(0).max(3) })
    .strict(),
  demo_lesson_opened: z.object({ topicId: z.string().max(100) }).strict(),
  demo_completed: z.object({}).strict(),
  signup_completed: z
    .object({ method: z.enum(["email", "telegram"]), fromDemo: z.boolean() })
    .strict(),
  topic_opened: z.object({ topicId: z.string(), isFree: z.boolean() }).strict(),
  gap_answered: z
    .object({ gapId: z.string(), isCorrect: z.boolean() })
    .strict(),
  test_completed: z
    .object({ topicId: z.string(), score: z.number().min(0).max(1) })
    .strict(),
  review_session_completed: z
    .object({ reviewed: z.number().int().nonnegative() })
    .strict(),
  tutor_message_sent: z
    .object({ context: z.enum(["lesson", "tutor", "explain"]) })
    .strict(),
  tutor_limit_reached: z
    .object({ plan: z.enum(["demo", "free", "paid"]) })
    .strict(),
  paywall_shown: z.object({ topicId: z.string() }).strict(),
};
export type EventName = keyof typeof eventSchemas;
export async function track(
  name: EventName,
  props: unknown,
  actor: Actor | { anonId: string },
  db: Prisma.TransactionClient = getDb(),
  dedupeKey?: string,
) {
  const validated = eventSchemas[name].parse(props);
  let userId: string | undefined, anonId: string | undefined;
  if ("anonId" in actor) anonId = actor.anonId;
  else if (actor.userId) userId = actor.userId;
  else
    anonId = (
      await db.demoSession.findUnique({
        where: { id: actor.demoSessionId },
        select: { anonId: true },
      })
    )?.anonId;
  const data = {
    name,
    props: validated as Prisma.InputJsonObject,
    userId,
    anonId,
    dedupeKey,
  };
  if (dedupeKey)
    await db.event.upsert({ where: { dedupeKey }, create: data, update: {} });
  else await db.event.create({ data });
}
