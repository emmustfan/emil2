import { gapDefinition, gapExercisesSchema } from "../exercises";
import { z } from "zod";
import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { getSetting } from "../settings";
import { ContentError } from "./errors";
import { parseTopic } from "./parse";
import { getContentQueue, enqueuePublication } from "./jobs";
import {
  questionFields,
  type SubjectInput,
  type SectionInput,
  type TopicInput,
  type QuestionInput,
} from "./validation";
import type { SubjectDTO, TopicDTO, QuestionDTO } from "./types";
type Db = Prisma.TransactionClient;
const optionsSchema = z.array(z.object({ id: z.string(), text: z.string() }));
const notFound = () => new ContentError("Материал не найден.", 404);
const conflict = () =>
  new ContentError(
    "Материал уже изменён другим редактором. Сохраните свой текст отдельно и обновите страницу.",
    409,
    [],
    "stale",
  );
async function lock(tx: Db, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`content:${key}`},0))`;
}
function checkRevision(actual: number, expected: number) {
  if (actual !== expected) throw conflict();
}
export async function listSubjects(q = "", page = 1) {
  const size = await getSetting("content.pageSize");
  const where = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { slug: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const [items, total] = await Promise.all([
    getDb().subject.findMany({
      where,
      orderBy: [{ order: "asc" }, { id: "asc" }],
      skip: (page - 1) * size,
      take: size,
      include: {
        _count: { select: { topic_subjectId: true, section_subjectId: true } },
      },
    }),
    getDb().subject.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / size)) };
}
export async function getSubject(id: string) {
  const row = await getDb().subject.findUnique({ where: { id } });
  if (!row) throw notFound();
  return row;
}
export async function listSections(subjectId: string) {
  return getDb().section.findMany({
    where: { subjectId },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });
}
export async function listTopics(subjectId: string, q = "", page = 1) {
  const size = await getSetting("content.pageSize");
  const where = {
    subjectId,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { slug: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    getDb().topic.findMany({
      where,
      orderBy: [{ order: "asc" }, { id: "asc" }],
      skip: (page - 1) * size,
      take: size,
      include: {
        section: { select: { title: true } },
        _count: {
          select: { question_topicId: { where: { archivedAt: null } } },
        },
      },
    }),
    getDb().topic.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / size)) };
}
export async function getTopic(
  id: string,
  db: Db = getDb(),
): Promise<TopicDTO> {
  const row = await db.topic.findUnique({
    where: { id },
    include: {
      subject: { select: { id: true, title: true, slug: true } },
      question_topicId: {
        where: { archivedAt: null },
        orderBy: [{ order: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!row) throw notFound();
  const questions: QuestionDTO[] = row.question_topicId.map((q) => ({
    id: q.id,
    topicId: q.topicId,
    answerType: q.answerType,
    acceptedAnswers: q.acceptedAnswers,
    stem: q.stem,
    options: optionsSchema.parse(q.options),
    correctOptionIds: q.correctOptionIds,
    explanation: q.explanation,
    sourceBlockKey: q.sourceBlockKey,
    isDiagnostic: q.isDiagnostic,
    order: q.order,
  }));
  return {
    id: row.id,
    subjectId: row.subjectId,
    sectionId: row.sectionId,
    title: row.title,
    slug: row.slug,
    order: row.order,
    isFree: row.isFree,
    contentMd: row.contentMd,
    gapExercises: gapExercisesSchema.parse(row.gapExercises),
    readingMinutes: row.readingMinutes,
    authorName: row.authorName,
    reviewerName: row.reviewerName,
    referencesMd: row.referencesMd,
    needsExpertReview: row.needsExpertReview,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    status: row.status,
    version: row.version,
    editRevision: row.editRevision,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    subject: row.subject,
    questions,
  };
}
export async function createSubject(data: SubjectInput) {
  return getDb().subject.create({ data });
}
export async function updateSubject(
  id: string,
  revision: number,
  data: SubjectInput,
) {
  return getDb().$transaction(async (tx) => {
    await lock(tx, `subject:${id}`);
    const row = await tx.subject.findUnique({ where: { id } });
    if (!row) throw notFound();
    checkRevision(row.editRevision, revision);
    return tx.subject.update({
      where: { id },
      data: { ...data, editRevision: { increment: 1 } },
    });
  });
}
export async function deleteSubject(id: string, revision: number) {
  return getDb().$transaction(async (tx) => {
    await lock(tx, `subject:${id}`);
    const row = await tx.subject.findUnique({ where: { id } });
    if (!row) throw notFound();
    checkRevision(row.editRevision, revision);
    if (row.status === "PUBLISHED")
      throw new ContentError("Сначала переведите предмет в черновик.", 409);
    await tx.subject.delete({ where: { id } });
    return { id };
  });
}
export async function createSection(subjectId: string, data: SectionInput) {
  if (!(await getDb().subject.findUnique({ where: { id: subjectId } })))
    throw notFound();
  return getDb().section.create({ data: { ...data, subjectId } });
}
export async function updateSection(
  id: string,
  revision: number,
  data: SectionInput,
) {
  const changed = await getDb().section.updateMany({
    where: { id, editRevision: revision },
    data: { ...data, editRevision: { increment: 1 } },
  });
  if (!changed.count) throw conflict();
  return getDb().section.findUniqueOrThrow({ where: { id } });
}
export async function deleteSection(id: string, revision: number) {
  const deleted = await getDb().section.deleteMany({
    where: { id, editRevision: revision },
  });
  if (!deleted.count) throw conflict();
  return { id };
}
async function validSection(
  db: Db,
  subjectId: string,
  sectionId: string | null,
) {
  if (
    sectionId &&
    !(await db.section.findFirst({ where: { id: sectionId, subjectId } }))
  )
    throw new ContentError("Раздел должен принадлежать выбранному предмету.");
}
function topicData(data: TopicInput) {
  const { reviewed, ...fields } = data;
  return {
    fields: {
      ...fields,
      authorName: fields.authorName || null,
      reviewerName: fields.reviewerName || null,
      referencesMd: fields.referencesMd || null,
    },
    reviewed,
  };
}
function validateReview(data: ReturnType<typeof topicData>) {
  if (
    data.reviewed &&
    (!data.fields.authorName ||
      !data.fields.reviewerName ||
      !data.fields.referencesMd)
  )
    throw new ContentError(
      "Для отметки проверки укажите автора, рецензента и источники.",
    );
}
export async function createTopic(subjectId: string, input: TopicInput) {
  const data = topicData(input);
  validateReview(data);
  return getDb().$transaction(async (tx) => {
    if (!(await tx.subject.findUnique({ where: { id: subjectId } })))
      throw notFound();
    await validSection(tx, subjectId, data.fields.sectionId);
    const row = await tx.topic.create({
      data: {
        ...data.fields,
        subjectId,
        needsExpertReview: !data.reviewed,
        reviewedAt: data.reviewed ? new Date() : null,
      },
    });
    return getTopic(row.id, tx);
  });
}
export async function updateTopic(
  id: string,
  revision: number,
  input: TopicInput,
) {
  const data = topicData(input);
  validateReview(data);
  return getDb().$transaction(async (tx) => {
    await lock(tx, `topic:${id}`);
    const row = await tx.topic.findUnique({ where: { id } });
    if (!row) throw notFound();
    checkRevision(row.editRevision, revision);
    await validSection(tx, row.subjectId, data.fields.sectionId);
    const unchanged =
      Object.entries(data.fields).every(
        ([key, value]) =>
          JSON.stringify(row[key as keyof typeof row]) ===
          JSON.stringify(value),
      ) && data.reviewed === !row.needsExpertReview;
    if (!unchanged)
      await tx.topic.update({
        where: { id },
        data: {
          ...data.fields,
          needsExpertReview: !data.reviewed,
          reviewedAt: data.reviewed ? new Date() : null,
          status: row.status === "PUBLISHED" ? "DRAFT" : row.status,
          editRevision: { increment: 1 },
        },
      });
    return getTopic(id, tx);
  });
}
export async function setTopicStatus(
  id: string,
  revision: number,
  status: "DRAFT" | "REVIEW",
) {
  return getDb().$transaction(async (tx) => {
    await lock(tx, `topic:${id}`);
    const row = await tx.topic.findUnique({ where: { id } });
    if (!row) throw notFound();
    checkRevision(row.editRevision, revision);
    if (row.status !== status)
      await tx.topic.update({
        where: { id },
        data: { status, editRevision: { increment: 1 } },
      });
    return getTopic(id, tx);
  });
}
async function changedTopic(tx: Db, id: string) {
  await tx.topic.update({
    where: { id },
    data: {
      needsExpertReview: true,
      reviewedAt: null,
      status: "DRAFT",
      editRevision: { increment: 1 },
    },
  });
}
async function validQuestionSource(
  tx: Db,
  topicId: string,
  input: QuestionInput,
) {
  const row = await tx.topic.findUniqueOrThrow({ where: { id: topicId } });
  if (
    input.sourceBlockKey &&
    !parseTopic(row.contentMd).blocks.some(
      (b) => b.blockKey === input.sourceBlockKey,
    )
  )
    throw new ContentError(
      "Блок-источник не найден в текущем тексте. Выберите его заново.",
    );
}
export async function createQuestion(
  topicId: string,
  revision: number,
  input: QuestionInput,
) {
  const data = questionFields.parse(input);
  return getDb().$transaction(async (tx) => {
    await lock(tx, `topic:${topicId}`);
    const topic = await tx.topic.findUnique({ where: { id: topicId } });
    if (!topic) throw notFound();
    checkRevision(topic.editRevision, revision);
    await validQuestionSource(tx, topicId, data);
    await tx.question.create({ data: { ...data, topicId } });
    await changedTopic(tx, topicId);
    return getTopic(topicId, tx);
  });
}
export async function updateQuestion(
  id: string,
  revision: number,
  input: QuestionInput,
) {
  const data = questionFields.parse(input);
  return getDb().$transaction(async (tx) => {
    const q = await tx.question.findUnique({ where: { id } });
    if (!q || q.archivedAt) throw notFound();
    await lock(tx, `topic:${q.topicId}`);
    const topic = await tx.topic.findUniqueOrThrow({
      where: { id: q.topicId },
    });
    checkRevision(topic.editRevision, revision);
    await validQuestionSource(tx, q.topicId, data);
    const current = await tx.question.findUniqueOrThrow({ where: { id } });
    if (
      Object.entries(data).some(
        ([key, value]) =>
          JSON.stringify(current[key as keyof typeof current]) !==
          JSON.stringify(value),
      )
    ) {
      await tx.question.update({ where: { id }, data });
      await changedTopic(tx, q.topicId);
    }
    return getTopic(q.topicId, tx);
  });
}
export async function deleteQuestion(id: string, revision: number) {
  return getDb().$transaction(async (tx) => {
    const q = await tx.question.findUnique({ where: { id } });
    if (!q || q.archivedAt) throw notFound();
    await lock(tx, `topic:${q.topicId}`);
    const topic = await tx.topic.findUniqueOrThrow({
      where: { id: q.topicId },
    });
    checkRevision(topic.editRevision, revision);
    await tx.question.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    await tx.card.updateMany({
      where: { questionId: id },
      data: { suspended: true },
    });
    await changedTopic(tx, q.topicId);
    return getTopic(q.topicId, tx);
  });
}
export async function deleteTopic(id: string, revision: number) {
  return getDb().$transaction(async (tx) => {
    await lock(tx, `topic:${id}`);
    const topic = await tx.topic.findUnique({ where: { id } });
    if (!topic) throw notFound();
    checkRevision(topic.editRevision, revision);
    if (topic.status === "PUBLISHED")
      throw new ContentError("Сначала переведите тему в черновик.", 409);
    await tx.contentChunk.deleteMany({ where: { topicId: id } });
    await tx.question.deleteMany({ where: { topicId: id } });
    await tx.gap.deleteMany({ where: { topicId: id } });
    await tx.topic.delete({ where: { id } });
    return { id };
  });
}
export async function publishTopic(id: string, revision: number) {
  const [minQuestions, maxQuestions] = await Promise.all([
    getSetting("content.minQuestions"),
    getSetting("content.maxQuestions"),
  ]);
  await getContentQueue();
  return getDb().$transaction(
    async (tx) => {
      await lock(tx, `topic:${id}`);
      const topic = await getTopic(id, tx);
      checkRevision(topic.editRevision, revision);
      const parsed = parseTopic(topic.contentMd);
      if (parsed.errors.length)
        throw new ContentError(
          "Исправьте ошибки в пропусках перед публикацией.",
          422,
          parsed.errors,
        );
      if (!parsed.gaps.length)
        throw new ContentError("Добавьте хотя бы один пропуск.");
      if (
        topic.questions.length < minQuestions ||
        topic.questions.length > maxQuestions
      )
        throw new ContentError(
          `В теме должно быть от ${minQuestions} до ${maxQuestions} вопросов.`,
        );
      for (const q of topic.questions) {
        questionFields.parse({
          answerType: q.answerType,
          acceptedAnswers: q.acceptedAnswers,
          stem: q.stem,
          options: q.options,
          correctOptionIds: q.correctOptionIds,
          explanation: q.explanation,
          sourceBlockKey: q.sourceBlockKey,
          isDiagnostic: q.isDiagnostic,
          order: q.order,
        });
        if (
          q.sourceBlockKey &&
          !parsed.blocks.some((b) => b.blockKey === q.sourceBlockKey)
        )
          throw new ContentError(
            "У вопроса устарел блок-источник. Выберите его заново.",
          );
      }
      const subject = await tx.subject.findUniqueOrThrow({
        where: { id: topic.subjectId },
      });
      if (subject.status !== "PUBLISHED")
        throw new ContentError("Сначала опубликуйте предмет.");
      if (
        topic.needsExpertReview ||
        !topic.reviewedAt ||
        !topic.authorName ||
        !topic.reviewerName ||
        !topic.referencesMd
      )
        throw new ContentError(
          "Тема должна быть проверена экспертом: укажите автора, рецензента, источники и отметку проверки.",
        );
      if (topic.status === "PUBLISHED") return topic;
      if (topic.status !== "REVIEW")
        throw new ContentError("Сначала отправьте тему на проверку.");
      const activeKeys = parsed.gaps.map((g) => g.gapKey);
      const removed = await tx.gap.findMany({
        where: { topicId: id, archivedAt: null, gapKey: { notIn: activeKeys } },
        select: { id: true },
      });
      if (removed.length) {
        const ids = removed.map((g) => g.id);
        await tx.gap.updateMany({
          where: { id: { in: ids } },
          data: { archivedAt: new Date() },
        });
        await tx.card.updateMany({
          where: { gapId: { in: ids } },
          data: { suspended: true },
        });
      }
      for (const gap of parsed.gaps) {
        const { gapKey, blockKey, order, answer, distractors, sentence } = gap;
        let definition;
        try {
          definition = gapDefinition(gap, topic.gapExercises[gap.gapKey]);
        } catch (error) {
          throw new ContentError(
            `Пропуск ${gap.order + 1}: ${error instanceof Error ? error.message : "проверьте настройки"}`,
            422,
            [
              {
                code: "exercise",
                message:
                  error instanceof Error ? error.message : "Проверьте задание",
                line: gap.line,
                column: 1,
              },
            ],
          );
        }
        const exercise = {
          answerType: definition.answerType,
          correctAnswers:
            definition.answerType === "SHORT_TEXT"
              ? []
              : definition.correctOptionIds,
          acceptedAnswers: definition.acceptedAnswers,
          explanation: definition.explanation,
        };
        const previous = await tx.gap.findUnique({
          where: { topicId_gapKey: { topicId: id, gapKey } },
        });
        const row = await tx.gap.upsert({
          where: { topicId_gapKey: { topicId: id, gapKey } },
          create: {
            ...exercise,
            topicId: id,
            gapKey,
            blockKey,
            order,
            answer,
            distractors,
            sentence,
          },
          update: {
            ...exercise,
            blockKey,
            order,
            answer,
            distractors,
            sentence,
            archivedAt: null,
          },
        });
        if (previous?.archivedAt)
          await tx.card.updateMany({
            where: { gapId: row.id },
            data: { suspended: false },
          });
      }
      const published = await tx.topic.update({
        where: { id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          version: { increment: 1 },
          editRevision: { increment: 1 },
        },
      });
      await enqueuePublication(tx, published);
      return getTopic(id, tx);
    },
    { timeout: 30000 },
  );
}
export function subjectDTO(row: SubjectDTO): SubjectDTO {
  const {
    id,
    title,
    slug,
    shortDescription,
    descriptionMd,
    courses,
    order,
    status,
    seoTitle,
    seoDescription,
    editRevision,
  } = row;
  return {
    id,
    title,
    slug,
    shortDescription,
    descriptionMd,
    courses,
    order,
    status,
    seoTitle,
    seoDescription,
    editRevision,
  };
}
