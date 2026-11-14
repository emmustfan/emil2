import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { isToken, hashToken } from "../auth/crypto";
import { lock } from "../auth/session";
import { AuthError } from "../auth/errors";
import { getSetting } from "../settings";
import { progressFor } from "../lessons/service";
import { lockLearningActor } from "../lessons/actor";
import { refund } from "../tutor/quota";
import { track } from "../analytics/events";
import { readTouch } from "../analytics/identity";
export type Visit = {
  signup?: boolean;
  demoToken?: string;
  anonToken?: string;
  touch?: string;
};
export async function transferGuest(
  userId: string,
  visit: Visit,
  db?: Prisma.TransactionClient,
) {
  const days = await getSetting("lesson.guestDays"),
    threshold = await getSetting("lesson.passThreshold");
  const apply = async (tx: Prisma.TransactionClient) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.consentPdAt || user.blockedAt || user.deletedAt)
      throw new AuthError("forbidden", 403);
    const anonId = isToken(visit.anonToken)
      ? hashToken(visit.anonToken)
      : undefined;
    const demoHash = isToken(visit.demoToken)
      ? hashToken(visit.demoToken)
      : undefined;
    if (demoHash) await lock(tx, `lesson-guest:${demoHash}`);
    const demo = demoHash
      ? await tx.demoSession.findFirst({
          where: {
            anonId: demoHash,
            userId: null,
            createdAt: { gt: new Date(Date.now() - days * 86400000) },
          },
          orderBy: { createdAt: "desc" },
        })
      : null;
    if (demo) {
      await lock(tx, `demo-flow:${demo.id}`);
      await lockLearningActor(tx, { demoSessionId: demo.id });
    }
    await lockLearningActor(tx, { userId });
    if (demo) {
      await lock(tx, `srs:user:${userId}`);
      await lock(tx, `usage:tutor:demo:${demo.id}`);
      const running = await tx.tutorMessage.findMany({
        where: { conversation: { demoSessionId: demo.id }, status: "RUNNING" },
      });
      for (const message of running)
        if (message.runToken)
          await refund(
            tx,
            { demoSessionId: demo.id },
            message.id,
            message.runToken,
          );
      const answers = await tx.gapAnswer.findMany({
        where: { demoSessionId: demo.id },
      });
      const topicIds = new Set<string>();
      for (const answer of answers) {
        const gap = await tx.gap.findUniqueOrThrow({
          where: { id: answer.gapId },
          select: { topicId: true },
        });
        topicIds.add(gap.topicId);
        const existing = await tx.gapAnswer.findUnique({
          where: { userId_gapId: { userId, gapId: answer.gapId } },
        });
        if (existing) await tx.gapAnswer.delete({ where: { id: answer.id } });
        else
          await tx.gapAnswer.update({
            where: { id: answer.id },
            data: { userId, demoSessionId: null },
          });
      }
      const cards = await tx.card.findMany({
        where: { demoSessionId: demo.id },
      });
      for (const card of cards) {
        const existing = await tx.card.findFirst({
          where: {
            userId,
            ...(card.gapId
              ? { gapId: card.gapId }
              : { questionId: card.questionId }),
          },
        });
        if (existing) {
          // Keep the user's schedule; historical demo ratings can safely refer to that card.
          await tx.reviewLog.updateMany({
            where: { cardId: card.id },
            data: { cardId: existing.id, cardRevision: null },
          });
          await tx.card.delete({ where: { id: card.id } });
        } else
          await tx.card.update({
            where: { id: card.id },
            data: {
              userId,
              demoSessionId: null,
              revealedAt: null,
              revealedTopicVersion: null,
            },
          });
      }
      const runs = await tx.testRun.findMany({
        where: { demoSessionId: demo.id },
        select: { topicId: true },
      });
      runs.forEach((r) => {
        if (r.topicId) topicIds.add(r.topicId);
      });
      await tx.testRun.updateMany({
        where: { demoSessionId: demo.id },
        data: { userId, demoSessionId: null },
      });
      await tx.tutorConversation.updateMany({
        where: { demoSessionId: demo.id },
        data: { userId, demoSessionId: null },
      });
      await tx.demoSession.update({ where: { id: demo.id }, data: { userId } });
      for (const topicId of [...topicIds].sort()) {
        await lock(tx, `content:topic:${topicId}`);
        await progressFor(topicId, { userId }, threshold, tx);
      }
    }
    const touch = readTouch(visit.touch);
    await tx.user.update({
      where: { id: userId },
      data: {
        ...(!user.anonId && anonId ? { anonId } : {}),
        ...(!user.utm && Object.keys(touch).length ? { utm: touch } : {}),
        ...(demo?.goal && demo.goal !== "skip"
          ? { goal: demo.goal === "other" ? demo.goalText : demo.goal }
          : {}),
        ...(demo?.diagnostic
          ? { diagnostic: demo.diagnostic as Prisma.InputJsonObject }
          : {}),
      },
    });
    // Attach only unclaimed events. An anonymous cookie never reassigns another user's data.
    if (anonId)
      await tx.event.updateMany({
        where: { anonId, userId: null },
        data: { userId },
      });
    if (demo)
      await tx.event.updateMany({
        where: { anonId: demo.anonId, userId: null },
        data: { userId },
      });
    const signup =
      visit.signup &&
      !(await tx.event.findUnique({
        where: { dedupeKey: `signup:${userId}` },
      }));
    if (signup)
      await track(
        "signup_completed",
        {
          method:
            user.telegramId && !user.emailVerifiedAt ? "telegram" : "email",
          fromDemo: !!demo,
        },
        { userId },
        tx,
        `signup:${userId}`,
      );
    return { transferred: !!demo, signup: !!signup };
  };
  return db ? apply(db) : getDb().$transaction(apply, { timeout: 15000 });
}
