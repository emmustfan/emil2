import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getDb } from "../../lib/db";
import { getEnv } from "../../lib/env";
import { assertDevelopment } from "../../lib/providers";
import { createStorageDriver } from "../../lib/storage";
import { parseTopic } from "../../lib/content/parse";
import { questionFields } from "../../lib/content/validation";
import { imageMarkdown } from "../../lib/content/image-reference";
import { gapDefinition, type GapExercises } from "../../lib/exercises";

export const DENTAL_DEMO_SLUG = "fdi-visual-demo";
export async function loadDentalDemo(imageIds: [string, string]) {
  let markdown = await readFile("content-seed/dental-demo/lesson.md", "utf8");
  markdown = markdown
    .replace(
      "{{IMAGE_QUADRANTS}}",
      imageMarkdown(
        imageIds[0],
        "Квадранты постоянных зубов FDI: справа и слева у пациента; выделен зуб 36",
        1280,
        760,
      ),
    )
    .replace(
      "{{IMAGE_TOOTH_CODE}}",
      imageMarkdown(
        imageIds[1],
        "Разбор кода 36: нижний левый квадрант и первый постоянный моляр",
        1200,
        560,
      ),
    );
  const parsed = parseTopic(markdown);
  if (parsed.errors.length)
    throw new Error("Invalid dental demonstration material");
  const exercises: GapExercises = {};
  for (const gap of parsed.gaps) {
    const d = gapDefinition(gap);
    d.explanation =
      gap.answerType === "SHORT_TEXT"
        ? "3 — нижний левый квадрант, 6 — первый постоянный моляр."
        : `Правильный ответ: ${gap.answer}. Сверьтесь с таблицей квадрантов и положением зуба от средней линии.`;
    if (gap.answerType === "SHORT_TEXT") d.acceptedAnswers = ["3.6"];
    exercises[gap.gapKey] = {
      answerType: d.answerType,
      correctAnswers: d.correctOptionIds.map(
        (id) => d.options.find((o) => o.id === id)!.text,
      ),
      acceptedAnswers: d.acceptedAnswers,
      explanation: d.explanation,
    };
  }
  const raw = JSON.parse(
    await readFile("content-seed/dental-demo/questions.json", "utf8"),
  ) as { sourceHeading: string }[];
  const questions = raw.map(({ sourceHeading, ...q }) => {
    const sourceBlockKey = parsed.blocks.find(
      (b) => b.heading === sourceHeading && b.kind !== "heading",
    )?.blockKey;
    if (!sourceBlockKey) throw new Error("Missing dental demo question source");
    return questionFields.parse({ ...q, sourceBlockKey });
  });
  return { markdown, parsed, exercises, questions };
}

// This is a draft for local preview, never an expert-approved public medical lesson.
export async function ensureDentalDemo(scope?: {
  subjectId: string;
  sectionId: string;
}) {
  assertDevelopment(getEnv());
  const db = getDb();
  const subjectId =
    scope?.subjectId ??
    (
      await db.subject.upsert({
        where: { slug: "propaedeutics" },
        create: {
          slug: "propaedeutics",
          title: "Пропедевтика стоматологических заболеваний",
          shortDescription: "Учебные материалы для рецензирования",
          courses: [1, 2, 3],
        },
        update: {},
      })
    ).id;
  const existing = await db.topic.findUnique({
    where: { subjectId_slug: { subjectId, slug: DENTAL_DEMO_SLUG } },
  });
  if (existing) return existing;
  const sectionId =
    scope?.sectionId ??
    (
      await db.section.upsert({
        where: { id: "seed-propaedeutics-anatomy" },
        create: {
          id: "seed-propaedeutics-anatomy",
          subjectId,
          title: "Анатомия и нумерация зубов",
          order: 1,
        },
        update: {},
      })
    ).id;
  const storage = createStorageDriver(getEnv()),
    staged: {
      id: string;
      storageKey: string;
      width: number;
      height: number;
      bytes: number;
    }[] = [];
  let keep = false;
  try {
    for (const name of ["quadrants", "code36"]) {
      const body = await readFile(`content-seed/dental-demo/${name}.webp`),
        metadata = await sharp(body).metadata(),
        id = randomUUID(),
        storageKey = `image_${id}`;
      await storage.put(storageKey, body);
      staged.push({
        id,
        storageKey,
        width: metadata.width!,
        height: metadata.height!,
        bytes: body.length,
      });
    }
    const lesson = await loadDentalDemo([staged[0].id, staged[1].id]);
    let created = false;
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dental-demo:${subjectId}`},0))`;
      const found = await tx.topic.findUnique({
        where: { subjectId_slug: { subjectId, slug: DENTAL_DEMO_SLUG } },
      });
      if (found) return found;
      const topic = await tx.topic.create({
        data: {
          subjectId,
          sectionId,
          slug: DENTAL_DEMO_SLUG,
          title: "Демо: нумерация зубов FDI",
          contentMd: lesson.markdown,
          gapExercises: lesson.exercises,
          isFree: true,
          order: -1,
          status: "DRAFT",
          needsExpertReview: true,
          aiGenerated: true,
          readingMinutes: 8,
          authorName: "Демонстрационный материал платформы",
          reviewerName: null,
          referencesMd:
            "1. [ISO 3950:2016 — Dentistry: Designation system for teeth and areas of the oral cavity](https://www.iso.org/standard/68292.html). Страница стандарта.\n2. [FDI World Dental Federation notation](https://en.wikipedia.org/wiki/FDI_World_Dental_Federation_notation). Открытый справочный обзор и таблицы нумерации.\n\nПроверено при подготовке примера 11 ноября 2026 года. Текст изложен самостоятельно; схемы созданы для платформы и не копируют иллюстрации источников. Материал создан с помощью ИИ, требует рецензии стоматолога и не предназначен для клинических решений.",
          images: { create: staged },
          gap_topicId: {
            create: lesson.parsed.gaps.map((g) => ({
              gapKey: g.gapKey,
              blockKey: g.blockKey,
              order: g.order,
              answer: g.answer,
              distractors: g.distractors,
              sentence: g.sentence,
              ...lesson.exercises[g.gapKey],
            })),
          },
          question_topicId: { create: lesson.questions },
        },
      });
      created = true;
      return topic;
    });
    keep = created;
    return result;
  } finally {
    if (!keep)
      await Promise.all(
        staged.map((image) => storage.remove(image.storageKey)),
      );
  }
}
