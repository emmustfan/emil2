import type { Prisma } from "../generated/prisma/client";
import { parseTopic } from "../content/parse";
import { optionsFromJSON, questionFeedback } from "../lessons/public";
import type { Actor, LessonVideo } from "../lessons/types";
import { rutubeEmbed } from "./rutube";

export function topicVideoIds(contentMd: string) {
  if (!contentMd.includes("::video{#")) return [];
  return [
    ...new Set(
      parseTopic(contentMd).blocks.flatMap((block) =>
        block.videoId ? [block.videoId] : [],
      ),
    ),
  ];
}

export async function lessonVideos(
  db: Prisma.TransactionClient,
  topic: { id: string; version: number; contentMd: string },
  actor: Actor,
): Promise<LessonVideo[]> {
  const ids = topicVideoIds(topic.contentMd);
  if (!ids.length) return [];
  const [videos, run] = await Promise.all([
    db.videoLecture.findMany({
      where: { id: { in: ids }, topicId: topic.id, archivedAt: null },
      include: {
        questions: {
          where: {
            topicId: topic.id,
            archivedAt: null,
            publishedAt: { not: null },
            atSec: { not: null },
          },
          orderBy: [{ atSec: "asc" }, { order: "asc" }, { id: "asc" }],
        },
        progress: { where: { userId: actor.userId ?? "" } },
      },
    }),
    actor.userId
      ? db.testRun.findFirst({
          where: {
            topicId: topic.id,
            userId: actor.userId,
            topicVersion: topic.version,
            mode: "VIDEO",
          },
          include: { questionAttempt_testRunId: true },
        })
      : null,
  ]);
  const attempts = new Map(
    run?.questionAttempt_testRunId.map((attempt) => [
      attempt.questionId,
      attempt,
    ]),
  );
  return videos.map((video) => {
    const progress = video.progress[0];
    return {
      id: video.id,
      src: rutubeEmbed(video),
      title: video.title,
      durationSec: video.durationSec,
      signedIn: !!actor.userId,
      allowWrites: !!actor.userId && !actor.readOnly,
      progress: progress ? publicVideoProgress(progress) : null,
      questions: video.questions.map((q) => {
        const attempt = attempts.get(q.id);
        return {
          id: q.id,
          atSec: q.atSec!,
          stem: q.stem,
          answerType: q.answerType,
          options: optionsFromJSON(q.options),
          feedback: attempt ? questionFeedback(q, attempt) : null,
        };
      }),
    };
  });
}

export function publicVideoProgress(progress: {
  lastPositionSec: number;
  watchedSec: number;
  selfReported: boolean;
  completedAt: Date | null;
}) {
  return {
    lastPositionSec: progress.lastPositionSec,
    watchedSec: progress.watchedSec,
    selfReported: progress.selfReported,
    completed: progress.completedAt !== null,
  };
}
