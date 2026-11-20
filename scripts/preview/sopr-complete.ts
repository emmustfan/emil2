import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "../../lib/auth/session";
import { withTopicDraft } from "../../lib/content/drafts";
import { imageMarkdown } from "../../lib/content/image-reference";
import { imageLimits, normalizeImage } from "../../lib/content/images";
import { parseTopic } from "../../lib/content/parse";
import { questionFields } from "../../lib/content/validation";
import { getDb } from "../../lib/db";
import { getEnv } from "../../lib/env";
import { withSettingsSnapshot } from "../../lib/settings";
import { createStorageDriver } from "../../lib/storage";
import catalog from "../../content-seed/sopr-complete/catalog.json";
import quiz from "../../content-seed/sopr-complete/questions.json";
import { assertStudentPreview } from "./student-profiles";

const subjectId = "preview-sopr-complete";
const folder = "content-seed/sopr-complete";
const references =
  "Хафизов Р. Г., Хафизова Ф. А., Малышев Н. В., Фасахов А. Р. Патоморфологические процессы и элементы поражения при заболеваниях слизистой оболочки полости рта. Казань: Издательство Казанского университета, 2019. 54 с.";
type FigureName = keyof typeof catalog.figures;
const markers = /\{\{image:([^}]+)\}\}/g;

export async function ensureSoprComplete() {
  assertStudentPreview(process.env.DATABASE_URL, process.env.NODE_ENV);
  const env = getEnv();
  if (env.STORAGE_DRIVER !== "local")
    throw new Error("Для предпросмотра пособия требуется локальное хранилище.");
  const db = getDb();
  const storage = createStorageDriver(env);
  const limits = await withSettingsSnapshot(imageLimits);
  const staged: string[] = [];
  try {
    await db.$transaction(
      async (tx) => {
        await lock(tx, subjectId);
        const exists = await tx.subject.findUnique({
          where: { id: subjectId },
        });
        if (exists) return;
        await tx.subject.create({
          data: {
            id: subjectId,
            slug: "sopr-khafizov-complete",
            title: "Слизистая оболочка полости рта · Полная методичка КФУ",
            shortDescription:
              "54 страницы пособия, 22 иллюстрации и пробный интерактивный урок в закрытом предпросмотре.",
            descriptionMd: references,
            status: "DRAFT",
            courses: [2, 3],
          },
        });

        const chapters = [
          {
            slug: "demo",
            title: "Пробный урок. Пятно, папула, пузырёк, эрозия и язва",
            section: "Пробный урок",
            first: 23,
            last: 32,
          },
          ...catalog.chapters,
        ];
        const sections = new Map<string, string>();
        for (const [order, chapter] of chapters.entries()) {
          let sectionId = sections.get(chapter.section);
          if (!sectionId) {
            const section = await tx.section.create({
              data: { subjectId, title: chapter.section, order: sections.size },
            });
            sectionId = section.id;
            sections.set(chapter.section, sectionId);
          }

          let contentMd = await readFile(
            join(folder, `${chapter.slug}.md`),
            "utf8",
          );
          const found = [...contentMd.matchAll(markers)];
          if (found.length > limits.maxPerTopic)
            throw new Error(`Превышен лимит иллюстраций. ${chapter.title}`);
          const images = [];
          for (const [marker, name] of found) {
            if (!Object.hasOwn(catalog.figures, name))
              throw new Error(`Иллюстрация отсутствует в каталоге. ${name}`);
            const figure = catalog.figures[name as FigureName];
            const png = name.endsWith(".png");
            const original = await readFile(join(folder, "figures", name));
            const { body, width, height } = await normalizeImage(
              original,
              png ? "image/png" : "image/jpeg",
              limits,
            );
            const id = randomUUID();
            const storageKey = `image_${id}`;
            await storage.put(storageKey, body);
            staged.push(storageKey);
            images.push({ id, storageKey, width, height, bytes: body.length });
            contentMd = contentMd.replace(
              marker,
              imageMarkdown(
                id,
                `${figure.alt}. Пособие, с. ${figure.page}.`,
                width,
                height,
              ),
            );
          }
          const parsed = parseTopic(contentMd);
          if (parsed.errors.length)
            throw new Error(
              `Ошибка в тексте «${chapter.title}». ${JSON.stringify(parsed.errors)}`,
            );
          const isDemo = chapter.slug === "demo";
          const questions = isDemo
            ? quiz.map(({ sourceHeading, ...question }, index) => {
                const block = parsed.blocks.find(
                  (item) =>
                    item.heading === sourceHeading && item.kind !== "heading",
                );
                if (!block)
                  throw new Error(`Не найден раздел для вопроса ${index + 1}.`);
                return questionFields.parse({
                  ...question,
                  sourceBlockKey: block.blockKey,
                  order: index,
                  isDiagnostic: false,
                });
              })
            : [];

          await tx.topic.create({
            data: withTopicDraft({
              id: `${subjectId}-${chapter.slug}`,
              subjectId,
              sectionId,
              slug: chapter.slug,
              title: chapter.title,
              contentMd,
              order,
              isFree: false,
              status: "DRAFT",
              needsExpertReview: true,
              aiGenerated: isDemo,
              readingMinutes: isDemo ? 4 : null,
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
            }),
          });
        }
      },
      { timeout: 60000 },
    );
  } catch (error) {
    await Promise.all(staged.map((key) => storage.remove(key)));
    throw error;
  }
  console.log(
    "Полная методичка доступна в предпросмотре: /admin/subjects/preview-sopr-complete",
  );
}
