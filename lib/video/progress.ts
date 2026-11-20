import { z } from "zod";
import { getDb } from "../db";
import { getSetting } from "../settings";
import { consumeLimit } from "../access";
import { AuthError } from "../auth/errors";
import { ContentError } from "../content/errors";
import { lockTopicForLearning } from "../content/locks";
import { lockLearningActor } from "../lessons/actor";
import { assertWritableActor } from "../lessons/identity";
import { accessibleTopic, grade, progressFor } from "../lessons/service";
import { optionsFromJSON, questionFeedback } from "../lessons/public";
import type { Actor } from "../lessons/types";
import {
  cardFromWrongQuestion,
  creationSettings,
  lessonReview,
} from "../srs/cards";
import type { Prisma } from "../generated/prisma/client";
import { publicVideoProgress, topicVideoIds } from "./catalog";
import { mergeWatchRanges, videoCompleted } from "./ranges";

const range = z.tuple([z.number(), z.number()]);
const version = z.number().int().min(1).optional();
export const watchInput = z.union([
  z
    .object({ ranges: z.array(range).max(120), position: z.number(), version })
    .strict(),
  z.object({ selfReported: z.literal(true), version }).strict(),
]);
export const videoAnswerInput = z
  .object({
    questionId: z.string().min(1).max(100),
    version: z.number().int().min(1),
    optionIds: z.array(z.string().min(1).max(64)).min(1).max(5).optional(),
    text: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .refine(
    (value) => (value.text === undefined) !== (value.optionIds === undefined),
  );

async function withVideo<T>(
  actor: Actor,
  id: string,
  revision: number | undefined,
  work: (
    tx: Prisma.TransactionClient,
    data: Awaited<ReturnType<typeof currentVideo>>,
  ) => Promise<T>,
) {
  assertWritableActor(actor);
  if (!actor.userId) throw new AuthError("unauthorized", 401);
  if (!z.uuid().safeParse(id).success)
    throw new ContentError("Видео не найдено.", 404);
  return getDb().$transaction(async (tx) => {
    await lockLearningActor(tx, actor);
    return work(tx, await currentVideo(tx, id, actor, revision));
  });
}

async function currentVideo(
  tx: Prisma.TransactionClient,
  id: string,
  actor: Actor,
  revision?: number,
) {
  const initial = await tx.videoLecture.findUnique({
    where: { id },
    select: { topicId: true },
  });
  if (!initial) throw new ContentError("Видео не найдено.", 404);
  await lockTopicForLearning(tx, initial.topicId);
  const topic = await accessibleTopic(initial.topicId, actor, tx);
  const ids = topicVideoIds(topic.contentMd);
  const video = await tx.videoLecture.findFirst({
    where: { id, topicId: topic.id, archivedAt: null },
    select: { id: true, durationSec: true },
  });
  if (!video || !ids.includes(id))
    throw new ContentError("Видео не найдено.", 404);
  if (revision !== undefined && topic.version !== revision)
    throw new ContentError("Тема обновлена. Перезагрузите страницу.", 409);
  return { video, topic, ids };
}

export async function saveVideoProgress(
  actor: Actor,
  id: string,
  input: z.infer<typeof watchInput>,
) {
  return withVideo(actor, id, input.version, async (tx, { video, topic }) => {
    const [limit, threshold, pass] = await Promise.all([
      getSetting("video.requestsPerMinute"),
      getSetting("video.completeThreshold"),
      getSetting("lesson.passThreshold"),
    ]);
    await consumeLimit(`user:${actor.userId!}`, {
      feature: `video:${id}`,
      max: limit,
      periodStart: new Date(Math.floor(Date.now() / 60000) * 60000),
      db: tx,
    });
    const key = { userId: actor.userId!, videoId: id };
    const where = { userId_videoId: key };
    const old = await tx.videoProgress.findUnique({ where });
    const previous = z.array(range).safeParse(old?.watchedRanges).data ?? [];
    const reported = "selfReported" in input;
    const merged = mergeWatchRanges(
      previous,
      reported ? [] : input.ranges,
      video.durationSec,
    );
    const position =
      !reported &&
      input.position >= 0 &&
      input.position <= (video.durationSec ?? 86400) + 5
        ? Math.min(Math.floor(input.position), video.durationSec ?? 86400)
        : (old?.lastPositionSec ?? 0);
    const data = {
      watchedRanges: merged.ranges,
      watchedSec: merged.watchedSec,
      lastPositionSec: position,
      selfReported: reported || !!old?.selfReported,
      completedAt:
        old?.completedAt ??
        (reported ||
        videoCompleted(merged.watchedSec, video.durationSec, threshold)
          ? new Date()
          : null),
    };
    const progress = await tx.videoProgress.upsert({
      where,
      create: { ...key, ...data },
      update: data,
    });
    return {
      video: publicVideoProgress(progress),
      progress: await progressFor(topic.id, actor, pass, tx, topic.contentMd),
    };
  });
}

export async function answerVideoQuestion(
  actor: Actor,
  id: string,
  input: z.infer<typeof videoAnswerInput>,
) {
  return withVideo(actor, id, input.version, async (tx, { topic, ids }) => {
    await consumeLimit(`user:${actor.userId!}`, {
      feature: "video-answer",
      max: await getSetting("lesson.requestsPerMinute"),
      periodStart: new Date(Math.floor(Date.now() / 60000) * 60000),
      db: tx,
    });
    const q = await tx.question.findFirst({
      where: {
        id: input.questionId,
        topicId: topic.id,
        videoId: id,
        archivedAt: null,
        publishedAt: { not: null },
      },
    });
    if (!q) throw new ContentError("Вопрос не найден.", 404);
    const criteria = {
      topicId: topic.id,
      userId: actor.userId!,
      topicVersion: topic.version,
      mode: "VIDEO" as const,
    };
    const run =
      (await tx.testRun.findFirst({ where: criteria })) ??
      (await tx.testRun.create({
        data: {
          ...criteria,
          subjectId: topic.subjectId,
          total: await tx.question.count({
            where: {
              topicId: topic.id,
              videoId: { in: ids },
              archivedAt: null,
              publishedAt: { not: null },
            },
          }),
        },
      }));
    const where = {
      testRunId_questionId: { testRunId: run.id, questionId: q.id },
    };
    const existing = await tx.questionAttempt.findUnique({ where });
    if (existing)
      return {
        feedback: questionFeedback(q, existing),
        review: await lessonReview(tx, actor, topic.id),
      };
    const checked = grade({ ...q, options: optionsFromJSON(q.options) }, input);
    const attempt = await tx.questionAttempt.create({
      data: {
        ...where.testRunId_questionId,
        chosenOptionIds: input.optionIds ?? [],
        chosenText: input.text,
        isCorrect: checked.isCorrect,
      },
    });
    if (!attempt.isCorrect)
      await cardFromWrongQuestion(
        tx,
        actor,
        q,
        topic.subjectId,
        await creationSettings(),
      );
    const answers = await tx.questionAttempt.count({
      where: { testRunId: run.id },
    });
    const correct = run.correct + Number(checked.isCorrect);
    await tx.testRun.update({
      where: { id: run.id },
      data: {
        correct,
        ...(answers === run.total
          ? { score: correct / run.total, finishedAt: new Date() }
          : {}),
      },
    });
    return {
      feedback: questionFeedback(q, attempt),
      review: await lessonReview(tx, actor, topic.id),
    };
  });
}
