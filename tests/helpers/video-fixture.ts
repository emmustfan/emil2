import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db";
import { recordInitialTopicRevision } from "../../lib/content/drafts";
import type { LessonFixture } from "./lesson-fixture";

export const testVideoExternalId = "d15d15d15d15d15d15d15d15d15d1500";
export const testVideoKey = "fixture-private-PKEY_1500";
export async function makeVideo(
  fixture: LessonFixture,
  target: "free" | "paid" = "paid",
  durationSec: number | null = 100,
) {
  const db = getDb();
  const topic = fixture[target];
  const video = await db.videoLecture.create({
    data: {
      id: randomUUID(),
      topicId: topic.id,
      title: "Проверочная видеолекция",
      externalId: testVideoExternalId,
      accessKey: testVideoKey,
      durationSec,
      patientConsentAt: new Date(),
    },
  });
  const marker = `::video{#${video.id}}`;
  await db.topic.update({
    where: { id: topic.id },
    data: {
      contentMd: `${marker}\n\n${topic.contentMd}`,
      draftContentMd: `${marker}\n\n${topic.draftContentMd}`,
    },
  });
  const question = await db.question.create({
    data: {
      topicId: topic.id,
      videoId: video.id,
      atSec: 3,
      publishedAt: new Date(),
      stem: "Что показано в проверочном фрагменте?",
      options: [
        { id: "a", text: "Верный вариант видео" },
        { id: "b", text: "Неверный вариант видео" },
        { id: "c", text: "Другой вариант видео" },
      ],
      correctOptionIds: ["a"],
      explanation: "ОБЪЯСНЕНИЕ_ВИДЕО_ПОСЛЕ_ОТВЕТА",
    },
  });
  await recordInitialTopicRevision(db, topic.id);
  return { topic, video, question, marker };
}

export function fixtureSubtitles(append = "") {
  return (
    "WEBVTT\n\n" +
    Array.from({ length: 6 }, (_, i) => {
      const minute = String(i * 6).padStart(2, "0");
      return `00:${minute}:10.000 --> 00:${minute}:12.000\nФрагмент ${i + 1} описывает проверочный пример и варианты ответа ${i + 1}.${i === 5 ? " " + append : ""}`;
    }).join("\n\n")
  );
}
