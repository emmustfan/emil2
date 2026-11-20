import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { getDb } from "../../lib/db";
import { parseTopic } from "../../lib/content/parse";
import {
  recordInitialTopicRevision,
  withTopicDraft,
} from "../../lib/content/drafts";
import { lock } from "../../lib/auth/session";
import { parseRutube } from "../../lib/video/rutube";
import { assertStudentPreview } from "./student-profiles";

export async function ensureVideoDemo() {
  assertStudentPreview(process.env.DATABASE_URL, process.env.NODE_ENV);
  const db = getDb();
  return db.$transaction(async (tx) => {
    await lock(tx, "preview:video-demo");
    const subject = await tx.subject.findUniqueOrThrow({
      where: { slug: "platform-demo" },
    });
    const slug = "test-video-lecture";
    if (
      await tx.topic.findUnique({
        where: { subjectId_slug: { subjectId: subject.id, slug } },
        select: { id: true },
      })
    )
      return;
    const videoId = randomUUID();
    const now = new Date();
    const contentMd =
      "## Тестовая видеолекция\n\nЭто демонстрация плеера и вопросов. Здесь можно проверить [[воспроизведение|настройки]].\n\n" +
      `::video{#${videoId}}`;
    const parsed = parseTopic(contentMd);
    const topic = await tx.topic.create({
      data: withTopicDraft({
        subjectId: subject.id,
        title: "Тестовая видеолекция",
        slug,
        contentMd,
        order: 99,
        isFree: true,
        status: "PUBLISHED",
        version: 1,
        publishedAt: now,
        needsExpertReview: true,
        videos: {
          create: {
            id: videoId,
            title: "Тестовая видеолекция",
            ...parseRutube(
              "https://rutube.ru/video/9230ec3691d02a011f7f32a577eb23d7/",
            )!,
            patientConsentAt: now,
          },
        },
        gap_topicId: {
          create: parsed.gaps.map((gap) => ({
            gapKey: gap.gapKey,
            blockKey: gap.blockKey,
            order: gap.order,
            answer: gap.answer,
            distractors: gap.distractors,
            sentence: gap.sentence,
          })),
        },
      }),
    });
    const options = [
      "Тестовый вариант А",
      "Тестовый вариант Б",
      "Тестовый вариант В",
    ].map((text, index) => ({ id: String(index + 1), text }));
    await tx.question.createMany({
      data: [
        ...[30, 60].map((atSec, order) => ({
          atSec,
          order,
          videoId,
          marker: `на ${atSec} секунде`,
        })),
        ...Array.from({ length: 5 }, (_, order) => ({
          atSec: null,
          order,
          videoId: null,
          marker: `в тесте №${order + 1}`,
        })),
      ].map(({ marker, ...fields }) => ({
        ...fields,
        topicId: topic.id,
        publishedAt: now,
        stem: `Демо-вопрос, не учебный материал. Выберите вариант А ${marker}.`,
        options,
        correctOptionIds: ["1"],
        explanation: "Демо-вопрос, не учебный материал.",
      })),
    });
    await recordInitialTopicRevision(tx, topic.id);
    return topic.id;
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await ensureVideoDemo();
  await getDb().$disconnect();
}
