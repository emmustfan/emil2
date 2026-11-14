import type { Prisma } from "../generated/prisma/client";
import type { Actor } from "../lessons/types";
import { getSetting } from "../settings";
export async function creationSettings() {
  const [ease, min, days] = await Promise.all([
    getSetting("srs.easeDefault"),
    getSetting("srs.easeMin"),
    getSetting("srs.goodFirstDays"),
  ]);
  return { ease: Math.max(ease, min), days };
}
export async function cardFromGap(
  tx: Prisma.TransactionClient,
  actor: Actor,
  source: { id: string; topicId: string },
  subjectId: string,
  correct: boolean,
  settings: Awaited<ReturnType<typeof creationSettings>>,
  now = new Date(),
) {
  const where = actor.userId
    ? { userId_gapId: { userId: actor.userId, gapId: source.id } }
    : {
        demoSessionId_gapId: {
          demoSessionId: actor.demoSessionId!,
          gapId: source.id,
        },
      };
  await tx.card.upsert({
    where,
    create: {
      ...actor,
      source: "GAP",
      gapId: source.id,
      topicId: source.topicId,
      subjectId,
      ease: settings.ease,
      dueAt: new Date(now.getTime() + (correct ? settings.days * 86400000 : 0)),
    },
    update: {},
  });
}
export async function cardFromWrongQuestion(
  tx: Prisma.TransactionClient,
  actor: Actor,
  source: { id: string; topicId: string },
  subjectId: string,
  settings: Awaited<ReturnType<typeof creationSettings>>,
  now = new Date(),
) {
  const where = actor.userId
    ? { userId_questionId: { userId: actor.userId, questionId: source.id } }
    : {
        demoSessionId_questionId: {
          demoSessionId: actor.demoSessionId!,
          questionId: source.id,
        },
      };
  const existing = await tx.card.findUnique({ where });
  if (existing) {
    if (!existing.suspended && existing.dueAt > now)
      await tx.card.update({
        where: { id: existing.id },
        data: {
          dueAt: now,
          revision: { increment: 1 },
          revealedAt: null,
          revealedTopicVersion: null,
        },
      });
    return;
  }
  await tx.card.create({
    data: {
      ...actor,
      source: "QUESTION",
      questionId: source.id,
      topicId: source.topicId,
      subjectId,
      ease: settings.ease,
      dueAt: now,
    },
  });
}
export async function lessonReview(
  tx: Prisma.TransactionClient,
  actor: Actor,
  topicId: string,
) {
  return {
    cards: await tx.card.count({
      where: { ...actor, topicId, suspended: false },
    }),
    signedIn: !!actor.userId,
  };
}
