import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "../../lib/auth/session";
import { withTopicDraft } from "../../lib/content/drafts";
import { imageMarkdown } from "../../lib/content/image-reference";
import { imageLimits, normalizeImage } from "../../lib/content/images";
import { lockTopicForChange } from "../../lib/content/locks";
import { parseTopic } from "../../lib/content/parse";
import { questionFields } from "../../lib/content/validation";
import { publishTopic, setTopicArchived } from "../../lib/content/service";
import { getDb } from "../../lib/db";
import { getEnv } from "../../lib/env";
import type { Prisma, Topic } from "../../lib/generated/prisma/client";
import { withSettingsSnapshot } from "../../lib/settings";
import { createStorageDriver } from "../../lib/storage";
import catalog from "../../content-seed/sopr-complete/catalog.json";
import quiz from "../../content-seed/sopr-complete/questions.json";
import { assertStudentPreview } from "./student-profiles";

const subjectId = "preview-sopr-complete";
const readyKey = "preview.soprInteractiveReady";
const publishedReadyKey = "preview.soprPublishedReady";
const folder = "content-seed/sopr-complete";
const title = "Слизистая оболочка полости рта · Курс по методичке КФУ";
const shortDescription =
  "Девять уроков по СОПР с иллюстрациями, заданиями с пропусками и тестами.";
const references =
  "Хафизов Р. Г., Хафизова Ф. А., Малышев Н. В., Фасахов А. Р. Патоморфологические процессы и элементы поражения при заболеваниях слизистой оболочки полости рта. Казань, Издательство Казанского университета, 2019. 54 с.";
type FigureName = keyof typeof catalog.figures;
type LessonSlug = keyof typeof quiz;

function isSeedDraft(topic: Topic) {
  return (
    !topic.editRevision &&
    !topic.version &&
    topic.status === "DRAFT" &&
    !topic.archivedAt &&
    topic.draftState === "DRAFT" &&
    !topic.draftUpdatedById &&
    !topic.draftReviewed
  );
}

async function removePreface(tx: Prisma.TransactionClient) {
  const id = `${subjectId}-preface`;
  await lockTopicForChange(tx, id);
  const preface = await tx.topic.findUnique({
    where: { id },
    include: {
      _count: {
        select: { images: true, gap_topicId: true, question_topicId: true },
      },
    },
  });
  if (!preface || preface.subjectId !== subjectId) return;
  if (preface.version || preface.status === "PUBLISHED") {
    // Keep the publication's links, attempts and history.
    return;
  }

  if (
    isSeedDraft(preface) &&
    Object.values(preface._count).every((count) => !count)
  ) {
    await tx.topic.delete({ where: { id } });
  } else {
    // Remove the chapter from the course while keeping any changes made in the editor.
    const archive = await tx.subject.upsert({
      where: { id: "preview-sopr-archive" },
      create: {
        id: "preview-sopr-archive",
        slug: "sopr-archived-drafts",
        title: "СОПР · архив черновиков",
        shortDescription: "Черновики, снятые из учебного курса.",
        courses: [2, 3],
        status: "DRAFT",
      },
      update: {},
    });
    await tx.topic.update({
      where: { id },
      data: { subjectId: archive.id, sectionId: null },
    });
  }
  if (preface.sectionId)
    await tx.section.deleteMany({
      where: {
        id: preface.sectionId,
        editRevision: 0,
        title: "О пособии",
        topic_sectionId: { none: {} },
        importJob_sectionId: { none: {} },
      },
    });
}

async function ensureSoprDrafts() {
  assertStudentPreview(process.env.DATABASE_URL, process.env.NODE_ENV);
  const env = getEnv();
  if (env.STORAGE_DRIVER !== "local")
    throw new Error("Для предпросмотра пособия требуется локальное хранилище.");
  const db = getDb();
  if (await db.appSetting.findUnique({ where: { key: readyKey } })) return;

  const storage = createStorageDriver(env);
  const limits = await withSettingsSnapshot(imageLimits);
  const staged: string[] = [];
  const replaced: string[] = [];
  async function cleanup(keys: string[]) {
    const results = await Promise.allSettled(
      keys.map((key) => storage.remove(key)),
    );
    if (results.some((result) => result.status === "rejected"))
      console.error("sopr_preview_image_cleanup_failed");
  }

  try {
    await db.$transaction(
      async (tx) => {
        await lock(tx, subjectId);
        if (await tx.appSetting.findUnique({ where: { key: readyKey } }))
          return;

        const subject = await tx.subject.upsert({
          where: { id: subjectId },
          create: {
            id: subjectId,
            slug: "sopr-khafizov-complete",
            title,
            shortDescription,
            descriptionMd: references,
            status: "DRAFT",
            courses: [2, 3],
          },
          update: {},
        });
        if (
          subject.status === "DRAFT" &&
          !subject.editRevision &&
          subject.title !== title
        )
          await tx.subject.update({
            where: { id: subjectId },
            data: { title, shortDescription },
          });

        await removePreface(tx);

        const sections = new Map<string, string>();
        for (const [order, chapter] of catalog.chapters.entries()) {
          const id = `${subjectId}-${chapter.slug}`;
          await lockTopicForChange(tx, id);
          const existing = await tx.topic.findUnique({
            where: { id },
            include: { images: { select: { storageKey: true } } },
          });
          if (
            existing &&
            (existing.subjectId !== subjectId || !isSeedDraft(existing))
          )
            continue;

          let sectionId = sections.get(chapter.section);
          if (!sectionId) {
            const section =
              (await tx.section.findFirst({
                where: { subjectId, title: chapter.section },
                orderBy: { order: "asc" },
              })) ??
              (await tx.section.create({
                data: {
                  subjectId,
                  title: chapter.section,
                  order: sections.size,
                },
              }));
            sectionId = section.id;
            sections.set(chapter.section, sectionId);
          }

          let contentMd = await readFile(
            join(folder, `${chapter.slug}.md`),
            "utf8",
          );
          const found = [...contentMd.matchAll(/\{\{image:([^}]+)\}\}/g)];
          if (found.length > limits.maxPerTopic)
            throw new Error(`Превышен лимит иллюстраций. ${chapter.title}`);

          const images = [];
          for (const [marker, name] of found) {
            if (!Object.hasOwn(catalog.figures, name))
              throw new Error(`Иллюстрация отсутствует в каталоге. ${name}`);
            const figure = catalog.figures[name as FigureName];
            const original = await readFile(join(folder, "figures", name));
            const { body, width, height } = await normalizeImage(
              original,
              name.endsWith(".png") ? "image/png" : "image/jpeg",
              limits,
            );
            const imageKey = randomUUID();
            const storageKey = `image_${imageKey}`;
            await storage.put(storageKey, body);
            staged.push(storageKey);
            images.push({
              id: imageKey,
              storageKey,
              width,
              height,
              bytes: body.length,
            });
            contentMd = contentMd.replace(
              marker,
              imageMarkdown(imageKey, figure.alt, width, height),
            );
          }

          const parsed = parseTopic(contentMd);
          if (parsed.errors.length || parsed.gaps.length !== 3)
            throw new Error(
              `Проверьте пропуски в уроке «${chapter.title}». ${JSON.stringify(parsed.errors)}`,
            );
          const rows = quiz[chapter.slug as LessonSlug];
          if (rows?.length !== 5)
            throw new Error(`Отсутствует тест в уроке «${chapter.title}».`);
          const questions = rows.map(
            ({ sourceHeading, ...question }, index) => {
              const block = parsed.blocks.find(
                (item) =>
                  item.heading === sourceHeading && item.kind !== "heading",
              );
              if (!block)
                throw new Error(
                  `Не найден источник для вопроса ${index + 1} в уроке «${chapter.title}».`,
                );
              return questionFields.parse({
                ...question,
                sourceBlockKey: block.blockKey,
                order: index,
                isDiagnostic: false,
              });
            },
          );

          const material = withTopicDraft({
            subjectId,
            sectionId,
            slug: chapter.slug,
            title: chapter.title,
            contentMd,
            order,
            isFree: true,
            status: "DRAFT",
            needsExpertReview: true,
            aiGenerated: true,
            readingMinutes: 6,
            referencesMd: `${references}\n\nСтраницы ${chapter.first}–${chapter.last}.`,
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
            images: { create: images },
            question_topicId: { create: questions },
          });
          if (existing) {
            replaced.push(...existing.images.map((image) => image.storageKey));
            await tx.gap.deleteMany({ where: { topicId: id } });
            await tx.question.deleteMany({ where: { topicId: id } });
            await tx.topicImage.deleteMany({ where: { topicId: id } });
            await tx.topic.update({ where: { id }, data: material });
          } else {
            await tx.topic.create({ data: { id, ...material } });
          }
        }
        await tx.appSetting.create({ data: { key: readyKey, value: true } });
      },
      { timeout: 60000 },
    );
  } catch (error) {
    await cleanup(staged);
    throw error;
  }
  await cleanup(replaced);
}

export async function ensureSoprComplete() {
  await ensureSoprDrafts();
  await getDb().$transaction(
    async (tx) => {
      await lock(tx, publishedReadyKey);
      if (await tx.appSetting.findUnique({ where: { key: publishedReadyKey } }))
        return;
      await withSettingsSnapshot(publishSoprCourse);
      await tx.appSetting.create({
        data: { key: publishedReadyKey, value: true },
      });
    },
    { timeout: 120000 },
  );
}

async function publishSoprCourse() {
  const db = getDb();

  const oldDemoId = `${subjectId}-demo`;
  const redundantLessons = await db.topic.findMany({
    where: {
      archivedAt: null,
      OR: [
        { id: oldDemoId, subjectId },
        { title: { equals: "Нижний клык", mode: "insensitive" } },
        { draftTitle: { equals: "Нижний клык", mode: "insensitive" } },
      ],
    },
    select: { id: true, editRevision: true },
  });
  for (const lesson of redundantLessons)
    await setTopicArchived(lesson.id, lesson.editRevision, true);

  await db.$transaction(async (tx) => {
    await lockTopicForChange(tx, oldDemoId);
    const demo = await tx.topic.findUnique({
      where: { id: oldDemoId },
      include: { section: true },
    });
    const section = demo?.section;
    if (
      demo?.archivedAt &&
      section?.subjectId === subjectId &&
      section.title === "Пробный урок" &&
      !section.editRevision
    ) {
      await tx.topic.update({
        where: { id: oldDemoId },
        data: { sectionId: null },
      });
      await tx.section.deleteMany({
        where: {
          id: section.id,
          topic_sectionId: { none: {} },
          importJob_sectionId: { none: {} },
        },
      });
    }
  });

  const subject = await db.subject.findUniqueOrThrow({
    where: { id: subjectId },
  });
  if (subject.status !== "PUBLISHED")
    await db.subject.update({
      where: { id: subjectId },
      data: { status: "PUBLISHED", editRevision: { increment: 1 } },
    });
  await db.subject.updateMany({
    where: {
      id: subjectId,
      shortDescription:
        "Десять уроков по СОПР с иллюстрациями, заданиями с пропусками и тестами.",
    },
    data: { shortDescription },
  });
  const drafts = await db.topic.findMany({
    where: {
      subjectId,
      id: { in: catalog.chapters.map(({ slug }) => `${subjectId}-${slug}`) },
    },
    orderBy: { order: "asc" },
  });
  for (const topic of drafts.filter(isSeedDraft)) {
    if (!topic.isFree)
      await db.topic.update({
        where: { id: topic.id },
        data: { isFree: true },
      });
    await publishTopic(topic.id, topic.editRevision);
  }
  console.log(
    "Курс по СОПР доступен студентам: /subjects/sopr-khafizov-complete",
  );
}
