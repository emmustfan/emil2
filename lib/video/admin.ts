import { z } from "zod";
import { getDb } from "../db";
import { assertCan, lockContentStaff } from "../org";
import { lockTopicForChange } from "../content/locks";
import { parseTopic } from "../content/parse";
import { ContentError } from "../content/errors";
import {
  parseRutube,
  parseVideoTime,
  rutubeEmbed,
  rutubeLinkHelp,
} from "./rutube";
import { rejectVideoCredentials } from "./credentials";

const input = z
  .object({
    topicId: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    link: z.string().max(4000),
    duration: z.string().max(12),
    consent: z.literal(true),
  })
  .strict();

export const videoMetadata = {
  id: true,
  title: true,
  durationSec: true,
} as const;

export async function saveVideo(
  actorId: string,
  id: string | null,
  raw: unknown,
) {
  const data = input.parse(raw);
  const credentials = parseRutube(data.link);
  if (!credentials) throw new ContentError(rutubeLinkHelp);
  const durationSec = data.duration.trim()
    ? parseVideoTime(data.duration)
    : null;
  if (data.duration.trim() && !durationSec)
    throw new ContentError(
      "Укажите длительность в формате мм:сс или чч:мм:сс.",
    );
  return getDb().$transaction(async (tx) => {
    await lockContentStaff(tx, actorId);
    await lockTopicForChange(tx, data.topicId);
    const topic = await tx.topic.findUnique({ where: { id: data.topicId } });
    if (!topic) throw new ContentError("Тема не найдена.", 404);
    await assertCan(
      actorId,
      "content.edit",
      { subjectId: topic.subjectId },
      tx,
    );
    const existing =
      id &&
      (await tx.videoLecture.findFirst({
        where: { id, topicId: topic.id, archivedAt: null },
        select: videoMetadata,
      }));
    if (id && !existing) throw new ContentError("Видео не найдено.", 404);
    const questions = await tx.question.findMany({
      where: { topicId: topic.id, archivedAt: null },
      select: {
        stem: true,
        options: true,
        explanation: true,
        draft: true,
        sourceQuote: true,
      },
    });
    rejectVideoCredentials(
      [
        data.title,
        topic.contentMd,
        topic.draftContentMd,
        topic.title,
        topic.draftTitle,
        topic.referencesMd,
        topic.draftReferencesMd,
        questions,
      ],
      [credentials],
    );
    if (id && durationSec !== null) {
      const timing = await tx.question.findMany({
        where: { topicId: topic.id, archivedAt: null, draftDeleted: false },
        select: { atSec: true, videoId: true, draft: true },
      });
      if (
        timing.some((q) => {
          const draft = q.draft as { videoId?: string; atSec?: number } | null;
          return (
            (q.videoId === id && (q.atSec ?? 0) > durationSec) ||
            (draft?.videoId === id && (draft.atSec ?? 0) > durationSec)
          );
        })
      )
        throw new ContentError(
          "Сначала перенесите вопросы, которые выходят за новую длительность видео.",
        );
    }
    const fields = {
      title: data.title,
      ...credentials,
      durationSec,
      patientConsentAt: new Date(),
    };
    return id
      ? tx.videoLecture.update({
          where: { id },
          data: fields,
          select: videoMetadata,
        })
      : tx.videoLecture.create({
          data: { ...fields, topicId: topic.id, createdById: actorId },
          select: videoMetadata,
        });
  });
}

export async function archiveVideo(actorId: string, id: string) {
  return getDb().$transaction(async (tx) => {
    await lockContentStaff(tx, actorId);
    const video = await tx.videoLecture.findUnique({
      where: { id },
      select: { topicId: true },
    });
    if (!video) throw new ContentError("Видео не найдено.", 404);
    await lockTopicForChange(tx, video.topicId);
    const topic = await tx.topic.findUniqueOrThrow({
      where: { id: video.topicId },
    });
    await assertCan(
      actorId,
      "content.edit",
      { subjectId: topic.subjectId },
      tx,
    );
    if (
      [topic.contentMd, topic.draftContentMd].some((md) =>
        parseTopic(md).blocks.some((block) => block.videoId === id),
      )
    )
      throw new ContentError(
        "Уберите блок видео из текста и опубликуйте изменения перед архивированием.",
        409,
      );
    await tx.videoLecture.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return { ok: true };
  });
}

export async function draftVideoPreviews(
  actor: import("../org").ContentReader,
  topicId: string,
) {
  const db = getDb();
  const topic = await db.topic.findUnique({
    where: { id: topicId },
    select: { subjectId: true },
  });
  if (!topic) throw new ContentError("Тема не найдена.", 404);
  await assertCan(actor, "content.read", { subjectId: topic.subjectId });
  const videos = await db.videoLecture.findMany({
    where: { topicId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return videos.map((video) => ({
    id: video.id,
    title: video.title,
    durationSec: video.durationSec,
    src: rutubeEmbed(video),
    allowWrites: false,
    signedIn: true,
    progress: null,
    questions: [],
  }));
}
