import type { ContentReader } from "./permissions";
import { contentActor, authorizeSubject, contentWrite } from "./permissions";
import {
  gapDefinition,
  gapExercisesSchema,
  gapExerciseFor,
} from "../exercises";
import { z } from "zod";
import { getDb } from "../db";
import { Prisma, type Question } from "../generated/prisma/client";
import { getSetting } from "../settings";
import { ContentError } from "./errors";
import {
  contentFieldIssues,
  contentFieldSummary,
  fieldIssue,
} from "./field-errors";
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
import { createStorageDriver } from "../storage";
import { getEnv } from "../env";
import { lockTopicForChange } from "./locks";
import {
  pinLegacyGapIds,
  stabilizeGapIds,
  correctGapAnswersChanged,
  existingGapIdentities,
} from "./gap-identity";
import { initialTopicDraft } from "./drafts";
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
function questionDTO(q: Question, working = true): QuestionDTO {
  const source = working && q.draft ? questionFields.parse(q.draft) : q;
  return {
    id: q.id,
    topicId: q.topicId,
    answerType: source.answerType,
    acceptedAnswers: source.acceptedAnswers ?? [],
    stem: source.stem,
    options: optionsSchema.parse(source.options),
    correctOptionIds: source.correctOptionIds,
    explanation: source.explanation,
    sourceBlockKey: source.sourceBlockKey,
    isDiagnostic: source.isDiagnostic,
    order: source.order,
    publishedAt: q.publishedAt?.toISOString() ?? null,
    hasDraft: working && !!q.draft,
  };
}
export async function listSubjects(q = "", page = 1, actorId?: ContentReader) {
  const actor = await contentActor(actorId);
  const size = await getSetting("content.pageSize");
  const where = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { slug: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const scopedWhere: Prisma.SubjectWhereInput = {
    AND: [
      where,
      actor?.role === "EDITOR"
        ? { teachingAssignments: { some: { teacherId: actor.id } } }
        : {},
    ],
  };
  const [items, total] = await Promise.all([
    getDb().subject.findMany({
      where: scopedWhere,
      orderBy: [{ order: "asc" }, { id: "asc" }],
      skip: (page - 1) * size,
      take: size,
      include: {
        _count: { select: { topic_subjectId: true, section_subjectId: true } },
      },
    }),
    getDb().subject.count({ where: scopedWhere }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / size)) };
}
export async function getSubject(id: string, actorId?: ContentReader) {
  await authorizeSubject(id, actorId);
  const row = await getDb().subject.findUnique({ where: { id } });
  if (!row) throw notFound();
  return row;
}
export async function listSections(subjectId: string, actorId?: ContentReader) {
  await authorizeSubject(subjectId, actorId);
  return getDb().section.findMany({
    where: { subjectId },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });
}
export async function listTopics(
  subjectId: string,
  q = "",
  page = 1,
  actorId?: ContentReader,
) {
  await authorizeSubject(subjectId, actorId);
  const size = await getSetting("content.pageSize");
  const where = {
    subjectId,
    ...(q
      ? {
          OR: [
            { draftTitle: { contains: q, mode: "insensitive" as const } },
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
          select: {
            question_topicId: {
              where: { archivedAt: null, draftDeleted: false },
            },
          },
        },
      },
    }),
    getDb().topic.count({ where }),
  ]);
  return {
    items: items.map((item) => ({ ...item, title: item.draftTitle })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / size)),
  };
}
export async function getTopic(
  id: string,
  db: Db = getDb(),
  actorId?: ContentReader,
): Promise<TopicDTO> {
  const row = await db.topic.findUnique({
    where: { id },
    include: {
      subject: { select: { id: true, title: true, slug: true, status: true } },
      images: { select: { id: true } },
      gap_topicId: { select: { gapKey: true, sentence: true, answer: true } },
      question_topicId: {
        where: { archivedAt: null },
        orderBy: [{ order: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!row) throw notFound();
  await authorizeSubject(row.subjectId, actorId, db);
  const stable = pinLegacyGapIds(
    row.contentMd,
    gapExercisesSchema.parse(row.gapExercises),
    existingGapIdentities(row.gap_topicId),
  );
  const questions = row.question_topicId
    .filter((q) => !q.draftDeleted)
    .map((q) => questionDTO(q))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const draft = pinLegacyGapIds(
    row.draftContentMd,
    gapExercisesSchema.parse(row.draftGapExercises),
    existingGapIdentities(row.gap_topicId),
  );
  const editor = row.draftUpdatedById
    ? await db.user.findUnique({
        where: { id: row.draftUpdatedById },
        select: { id: true, name: true },
      })
    : null;
  return {
    imageIds: row.images.map((i) => i.id),
    id: row.id,
    subjectId: row.subjectId,
    sectionId: row.sectionId,
    title: row.draftTitle,
    slug: row.slug,
    order: row.order,
    isFree: row.isFree,
    ...draft,
    readingMinutes: row.draftReadingMinutes,
    authorName: row.draftAuthorName,
    reviewerName: row.draftReviewerName,
    referencesMd: row.draftReferencesMd,
    needsExpertReview: !row.draftReviewed,
    reviewedAt: row.draftReviewed
      ? ((row.draftUpdatedAt ?? row.reviewedAt)?.toISOString() ?? null)
      : null,
    draftState: row.draftState,
    draftUpdatedAt: row.draftUpdatedAt?.toISOString() ?? null,
    draftUpdatedBy: editor,
    published:
      row.version > 0
        ? {
            title: row.title,
            ...stable,
            readingMinutes: row.readingMinutes,
            authorName: row.authorName,
            reviewerName: row.reviewerName,
            referencesMd: row.referencesMd,
            questions: row.question_topicId
              .filter((q) => q.publishedAt)
              .map((q) => questionDTO(q, false)),
          }
        : null,
    status: row.status,
    version: row.version,
    editRevision: row.editRevision,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    subject: row.subject,
    questions,
  };
}
export async function createSubject(data: SubjectInput, actorId?: string) {
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId, true);
    return tx.subject.create({ data });
  });
}
export async function updateSubject(
  id: string,
  revision: number,
  data: SubjectInput,
  actorId?: string,
) {
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId, true);
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
export async function deleteSubject(
  id: string,
  revision: number,
  actorId?: string,
) {
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId, true);
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
export async function createSection(
  subjectId: string,
  data: SectionInput,
  actorId?: string,
) {
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId);
    await authorizeSubject(subjectId, actorId, tx);
    if (!(await tx.subject.count({ where: { id: subjectId } })))
      throw notFound();
    return tx.section.create({ data: { ...data, subjectId } });
  });
}
export async function updateSection(
  id: string,
  revision: number,
  data: SectionInput,
  actorId?: string,
) {
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId);
    const row = await tx.section.findUnique({ where: { id } });
    if (!row) throw notFound();
    await authorizeSubject(row.subjectId, actorId, tx);
    const changed = await tx.section.updateMany({
      where: { id, editRevision: revision },
      data: { ...data, editRevision: { increment: 1 } },
    });
    if (!changed.count) throw conflict();
    return tx.section.findUniqueOrThrow({ where: { id } });
  });
}
export async function deleteSection(
  id: string,
  revision: number,
  actorId?: string,
) {
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId);
    const row = await tx.section.findUnique({ where: { id } });
    if (!row) throw notFound();
    await authorizeSubject(row.subjectId, actorId, tx);
    const removed = await tx.section.deleteMany({
      where: { id, editRevision: revision },
    });
    if (!removed.count) throw conflict();
    return { id };
  });
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
export async function createTopic(
  subjectId: string,
  input: TopicInput,
  actorId?: string,
) {
  const data = topicData(input);
  validateReview(data);
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId, false);
    await authorizeSubject(subjectId, actorId, tx);
    if (!(await tx.subject.findUnique({ where: { id: subjectId } })))
      throw notFound();
    await validSection(tx, subjectId, data.fields.sectionId);
    const stable = stabilizeGapIds(
      data.fields.contentMd,
      data.fields.gapExercises,
    );
    const row = await tx.topic.create({
      data: {
        ...data.fields,
        ...stable,
        ...initialTopicDraft(
          { ...data.fields, ...stable, needsExpertReview: !data.reviewed },
          actorId,
        ),
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
  actorId?: string,
) {
  const data = topicData(input);
  validateReview(data);
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId, false);
    await lockTopicForChange(tx, id);
    const row = await tx.topic.findUnique({ where: { id } });
    if (!row) throw notFound();
    await authorizeSubject(row.subjectId, actorId, tx);
    checkRevision(row.editRevision, revision);
    if (row.version > 0 && input.slug !== row.slug)
      throw new ContentError(
        "Адрес уже опубликованного урока менять нельзя: он используется в ссылках студентов.",
        422,
        [],
        "validation",
        [
          fieldIssue(
            "slug",
            "После первой публикации адрес урока сохраняется. Создайте новый урок, если нужен другой адрес.",
          ),
        ],
      );
    await validSection(tx, row.subjectId, data.fields.sectionId);
    const known = existingGapIdentities(
      await tx.gap.findMany({
        where: { topicId: id },
        select: { gapKey: true, sentence: true, answer: true },
      }),
    );
    const fields = {
      ...data.fields,
      ...stabilizeGapIds(
        data.fields.contentMd,
        data.fields.gapExercises ??
          gapExercisesSchema.parse(row.draftGapExercises),
        known,
      ),
    };
    const before = await getTopic(id, tx);
    const unchanged =
      Object.entries(fields).every(
        ([key, value]) =>
          JSON.stringify(before[key as keyof TopicDTO]) ===
          JSON.stringify(value),
      ) && data.reviewed === row.draftReviewed;
    if (!unchanged)
      await tx.topic.update({
        where: { id },
        data: {
          slug: fields.slug,
          sectionId: fields.sectionId,
          order: fields.order,
          isFree: fields.isFree,
          ...initialTopicDraft(
            { ...fields, needsExpertReview: !data.reviewed },
            actorId,
          ),
          editRevision: { increment: 1 },
        },
      });
    else if (
      row.draftContentMd !== fields.contentMd ||
      JSON.stringify(row.draftGapExercises) !==
        JSON.stringify(fields.gapExercises)
    )
      await tx.topic.update({
        where: { id },
        data: {
          draftContentMd: fields.contentMd,
          draftGapExercises: fields.gapExercises,
        },
      });
    return getTopic(id, tx);
  });
}
export async function setTopicStatus(
  id: string,
  revision: number,
  status: "DRAFT" | "REVIEW",
  actorId?: string,
) {
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId);
    await lockTopicForChange(tx, id);
    const row = await tx.topic.findUnique({ where: { id } });
    if (!row) throw notFound();
    await authorizeSubject(row.subjectId, actorId, tx);
    checkRevision(row.editRevision, revision);
    if (row.draftState !== status)
      await tx.topic.update({
        where: { id },
        data: { draftState: status, editRevision: { increment: 1 } },
      });
    return getTopic(id, tx);
  });
}
async function changedTopic(tx: Db, id: string, actorId?: string) {
  await tx.topic.update({
    where: { id },
    data: {
      draftReviewed: false,
      draftState: "DRAFT",
      draftUpdatedAt: new Date(),
      draftUpdatedById: actorId ?? null,
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
    !parseTopic(row.draftContentMd).blocks.some(
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
  actorId?: string,
) {
  const data = questionFields.parse(input);
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId, false);
    await lockTopicForChange(tx, topicId);
    const topic = await tx.topic.findUnique({ where: { id: topicId } });
    if (!topic) throw notFound();
    await authorizeSubject(topic.subjectId, actorId, tx);
    checkRevision(topic.editRevision, revision);
    await validQuestionSource(tx, topicId, data);
    await tx.question.create({ data: { ...data, topicId } });
    await changedTopic(tx, topicId, actorId);
    return getTopic(topicId, tx);
  });
}
export async function updateQuestion(
  id: string,
  revision: number,
  input: QuestionInput,
  actorId?: string,
) {
  const data = questionFields.parse(input);
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId, false);
    const q = await tx.question.findUnique({ where: { id } });
    if (!q || q.archivedAt || q.draftDeleted) throw notFound();
    await lockTopicForChange(tx, q.topicId);
    const topic = await tx.topic.findUniqueOrThrow({
      where: { id: q.topicId },
    });
    await authorizeSubject(topic.subjectId, actorId, tx);
    checkRevision(topic.editRevision, revision);
    await validQuestionSource(tx, q.topicId, data);
    const current = await tx.question.findUniqueOrThrow({ where: { id } });
    const working = questionDTO(current);
    if (
      Object.entries(data).some(
        ([key, value]) =>
          JSON.stringify(working[key as keyof typeof working]) !==
          JSON.stringify(value),
      )
    ) {
      const live = questionDTO(current, false);
      const sameAsLive = Object.entries(data).every(
        ([key, value]) =>
          JSON.stringify(live[key as keyof typeof live]) ===
          JSON.stringify(value),
      );
      await tx.question.update({
        where: { id },
        data: current.publishedAt
          ? { draft: sameAsLive ? Prisma.DbNull : data }
          : data,
      });
      await changedTopic(tx, q.topicId, actorId);
    }
    return getTopic(q.topicId, tx);
  });
}
export async function deleteQuestion(
  id: string,
  revision: number,
  actorId?: string,
) {
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId, false);
    const q = await tx.question.findUnique({ where: { id } });
    if (!q || q.archivedAt || q.draftDeleted) throw notFound();
    await lockTopicForChange(tx, q.topicId);
    const topic = await tx.topic.findUniqueOrThrow({
      where: { id: q.topicId },
    });
    await authorizeSubject(topic.subjectId, actorId, tx);
    checkRevision(topic.editRevision, revision);
    await tx.question.update({
      where: { id },
      data:
        topic.version > 0 ? { draftDeleted: true } : { archivedAt: new Date() },
    });
    if (!topic.version)
      await tx.card.updateMany({
        where: { questionId: id },
        data: { suspended: true },
      });
    await changedTopic(tx, q.topicId, actorId);
    return getTopic(q.topicId, tx);
  });
}
export async function deleteTopic(
  id: string,
  revision: number,
  actorId?: string,
) {
  const result = await getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId, false);
    await lockTopicForChange(tx, id);
    const topic = await tx.topic.findUnique({ where: { id } });
    if (!topic) throw notFound();
    await authorizeSubject(topic.subjectId, actorId, tx);
    checkRevision(topic.editRevision, revision);
    if (topic.status === "PUBLISHED")
      throw new ContentError("Сначала снимите тему с публикации.", 409);
    if (await tx.topicRevision.count({ where: { topicId: id } }))
      throw new ContentError(
        "Урок с историей публикаций нельзя удалить. Снимите его с публикации, чтобы скрыть от студентов.",
        409,
      );
    const images = await tx.topicImage.findMany({
      where: { topicId: id },
      select: { storageKey: true },
    });
    await tx.contentChunk.deleteMany({ where: { topicId: id } });
    await tx.question.deleteMany({ where: { topicId: id } });
    await tx.gap.deleteMany({ where: { topicId: id } });
    await tx.topic.delete({ where: { id } });
    return { id, storageKeys: images.map((i) => i.storageKey) };
  });
  if (result.storageKeys.length) {
    const storage = createStorageDriver(getEnv());
    for (const key of result.storageKeys)
      try {
        await storage.remove(key);
      } catch {
        console.error("content_image_cleanup_failed");
      }
  }
  return { id: result.id };
}
export async function publishTopic(
  id: string,
  revision: number,
  actorId?: string,
) {
  const [minQuestions, maxQuestions] = await Promise.all([
    getSetting("content.minQuestions"),
    getSetting("content.maxQuestions"),
  ]);
  await getContentQueue();
  return getDb().$transaction(
    async (tx) => {
      await contentWrite(tx, actorId, false);
      await lockTopicForChange(tx, id);
      const currentTopic = await getTopic(id, tx);
      const known = await tx.gap.findMany({
        where: { topicId: id },
        select: { gapKey: true, sentence: true, answer: true },
      });
      const topic = {
        ...currentTopic,
        ...stabilizeGapIds(
          currentTopic.contentMd,
          currentTopic.gapExercises,
          existingGapIdentities(known),
        ),
      };
      await authorizeSubject(topic.subjectId, actorId, tx);
      checkRevision(topic.editRevision, revision);
      const parsed = parseTopic(topic.contentMd);
      const imageIds = [...new Set(parsed.images.map((i) => i.id))];
      if (
        imageIds.length !==
        (await tx.topicImage.count({
          where: { id: { in: imageIds }, topicId: id },
        }))
      )
        throw new ContentError(
          "Изображение не найдено или относится к другой теме. Загрузите его в эту тему.",
          422,
          [],
          "validation",
          [
            fieldIssue(
              "contentMd",
              "Повторно загрузите изображения этого урока кнопкой редактора.",
            ),
          ],
        );
      if (parsed.errors.length)
        throw new ContentError(
          "Исправьте ошибки в тексте методички перед публикацией.",
          422,
          parsed.errors,
        );
      if (!parsed.gaps.length)
        throw new ContentError(
          "Добавьте хотя бы один пропуск.",
          422,
          [],
          "validation",
          [
            fieldIssue(
              "contentMd",
              "Выделите слово в методичке и создайте хотя бы один пропуск.",
            ),
          ],
        );
      if (
        topic.questions.length < minQuestions ||
        topic.questions.length > maxQuestions
      )
        throw new ContentError(
          `В теме должно быть от ${minQuestions} до ${maxQuestions} вопросов.`,
          422,
          [],
          "validation",
          [
            fieldIssue(
              "questions",
              `Сохранено вопросов: ${topic.questions.length}. Нужно от ${minQuestions} до ${maxQuestions}.`,
            ),
          ],
        );
      for (const [questionIndex, q] of topic.questions.entries()) {
        const checkedQuestion = questionFields.safeParse({
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
        if (!checkedQuestion.success) {
          const fields = contentFieldIssues(checkedQuestion.error.issues, {
            id: q.id,
            number: questionIndex + 1,
          });
          throw new ContentError(
            contentFieldSummary(fields),
            422,
            [],
            "validation",
            fields,
          );
        }
        if (
          q.sourceBlockKey &&
          !parsed.blocks.some((b) => b.blockKey === q.sourceBlockKey)
        )
          throw new ContentError(
            `У вопроса ${questionIndex + 1} устарел блок-источник. Выберите его заново.`,
            422,
            [],
            "validation",
            [
              {
                ...fieldIssue(
                  "sourceBlockKey",
                  "Выберите блок-источник заново в редакторе вопроса.",
                ),
                path: `questions.${questionIndex}.sourceBlockKey`,
                label: `Вопрос ${questionIndex + 1} — Блок-источник`,
                target: `lesson-question-${q.id}`,
                questionId: q.id,
              },
            ],
          );
      }
      const subject = await tx.subject.findUniqueOrThrow({
        where: { id: topic.subjectId },
      });
      if (subject.status !== "PUBLISHED")
        throw new ContentError(
          "Сначала опубликуйте предмет.",
          422,
          [],
          "validation",
          [
            fieldIssue(
              "subject",
              "Откройте настройки предмета и установите статус «Опубликовано». Это делает администратор.",
            ),
          ],
        );
      if (
        topic.needsExpertReview ||
        !topic.reviewedAt ||
        !topic.authorName?.trim() ||
        !topic.reviewerName?.trim() ||
        !topic.referencesMd?.trim()
      ) {
        const fields = [];
        if (!topic.authorName?.trim())
          fields.push(fieldIssue("authorName", "Укажите автора урока."));
        if (!topic.reviewerName?.trim())
          fields.push(fieldIssue("reviewerName", "Укажите рецензента урока."));
        if (!topic.referencesMd?.trim())
          fields.push(
            fieldIssue(
              "referencesMd",
              "Добавьте источники учебного материала.",
            ),
          );
        if (topic.needsExpertReview || !topic.reviewedAt)
          fields.push(
            fieldIssue(
              "reviewed",
              "После фактической проверки отметьте «Проверено экспертом».",
            ),
          );
        throw new ContentError(
          "Тема должна быть проверена экспертом: укажите автора, рецензента, источники и отметку проверки.",
          422,
          [],
          "validation",
          fields,
        );
      }
      if (topic.status === "PUBLISHED" && topic.draftState === "CLEAN")
        return topic;
      if (
        topic.draftState !== "REVIEW" &&
        !(topic.draftState === "CLEAN" && topic.version > 0)
      )
        throw new ContentError(
          "Сначала отправьте тему на проверку.",
          422,
          [],
          "validation",
          [
            fieldIssue(
              "status",
              "В блоке «Перед публикацией» нажмите «Отправить на проверку», затем опубликуйте урок.",
            ),
          ],
        );
      const publicationTime = new Date();
      const pending = await tx.question.findMany({
        where: { topicId: id, archivedAt: null },
      });
      for (const question of pending) {
        if (question.draftDeleted) {
          await tx.question.update({
            where: { id: question.id },
            data: {
              archivedAt: publicationTime,
              draft: Prisma.DbNull,
              draftDeleted: false,
            },
          });
          await tx.card.updateMany({
            where: { questionId: question.id },
            data: { suspended: true },
          });
        } else {
          const changes = question.draft
            ? questionFields.parse(question.draft)
            : {};
          await tx.question.update({
            where: { id: question.id },
            data: {
              ...changes,
              publishedAt: question.publishedAt ?? publicationTime,
              draft: Prisma.DbNull,
              draftDeleted: false,
            },
          });
        }
      }
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
          definition = gapDefinition(
            gap,
            gapExerciseFor(topic.gapExercises, gap.gapKey),
          );
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
        if (previous && correctGapAnswersChanged(previous, row))
          await tx.card.updateMany({
            where: { gapId: row.id },
            data: {
              state: "NEW",
              dueAt: new Date(),
              intervalDays: 0,
              firstShownAt: null,
              suspended: false,
              revision: { increment: 1 },
              revealedAt: null,
              revealedTopicVersion: null,
            },
          });
      }
      const published = await tx.topic.update({
        where: { id },
        data: {
          status: "PUBLISHED",
          draftState: "CLEAN",
          title: topic.title,
          contentMd: topic.contentMd,
          gapExercises: topic.gapExercises,
          draftContentMd: topic.contentMd,
          draftGapExercises: topic.gapExercises,
          readingMinutes: topic.readingMinutes,
          referencesMd: topic.referencesMd,
          authorName: topic.authorName,
          reviewerName: topic.reviewerName,
          needsExpertReview: false,
          reviewedAt: publicationTime,
          publishedAt: publicationTime,
          version: { increment: 1 },
          editRevision: { increment: 1 },
        },
      });
      await tx.topicRevision.create({
        data: {
          topicId: id,
          version: published.version,
          title: published.title,
          contentMd: published.contentMd,
          gapExercises: topic.gapExercises,
          questions: topic.questions.map(questionSnapshot),
          publishedAt: publicationTime,
          publishedById: actorId ?? null,
        },
      });
      await enqueuePublication(tx, published);
      return getTopic(id, tx);
    },
    { timeout: 30000 },
  );
}
function questionSnapshot(q: QuestionDTO) {
  const {
    id,
    topicId,
    answerType,
    acceptedAnswers,
    stem,
    options,
    correctOptionIds,
    explanation,
    sourceBlockKey,
    isDiagnostic,
    order,
  } = q;
  return {
    id,
    topicId,
    answerType,
    acceptedAnswers,
    stem,
    options,
    correctOptionIds,
    explanation,
    sourceBlockKey,
    isDiagnostic,
    order,
  };
}

export async function discardTopicChanges(
  id: string,
  revision: number,
  actorId?: string,
) {
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId);
    await lockTopicForChange(tx, id);
    const row = await tx.topic.findUnique({ where: { id } });
    if (!row) throw notFound();
    await authorizeSubject(row.subjectId, actorId, tx);
    checkRevision(row.editRevision, revision);
    if (!row.version)
      throw new ContentError(
        "У урока ещё нет опубликованной версии, к которой можно вернуться.",
      );
    await tx.question.deleteMany({ where: { topicId: id, publishedAt: null } });
    await tx.question.updateMany({
      where: { topicId: id, publishedAt: { not: null } },
      data: { draft: Prisma.DbNull, draftDeleted: false },
    });
    await tx.topic.update({
      where: { id },
      data: {
        ...initialTopicDraft(
          {
            ...row,
            gapExercises: gapExercisesSchema.parse(row.gapExercises),
            status: "PUBLISHED",
          },
          actorId,
        ),
        editRevision: { increment: 1 },
      },
    });
    return getTopic(id, tx);
  });
}

export async function unpublishTopic(
  id: string,
  revision: number,
  actorId?: string,
) {
  return getDb().$transaction(async (tx) => {
    await contentWrite(tx, actorId);
    await lockTopicForChange(tx, id);
    const row = await tx.topic.findUnique({ where: { id } });
    if (!row) throw notFound();
    await authorizeSubject(row.subjectId, actorId, tx);
    checkRevision(row.editRevision, revision);
    if (row.status === "PUBLISHED")
      await tx.topic.update({
        where: { id },
        data: { status: "DRAFT", editRevision: { increment: 1 } },
      });
    return getTopic(id, tx);
  });
}

export async function listTopicRevisions(id: string, actorId?: ContentReader) {
  const topic = await getDb().topic.findUnique({
    where: { id },
    select: { subjectId: true },
  });
  if (!topic) throw notFound();
  await authorizeSubject(topic.subjectId, actorId);
  const rows = await getDb().topicRevision.findMany({
    where: { topicId: id },
    orderBy: { version: "desc" },
    select: { id: true, version: true, publishedAt: true, publishedById: true },
  });
  const users = await getDb().user.findMany({
    where: {
      id: {
        in: rows.flatMap((row) =>
          row.publishedById ? [row.publishedById] : [],
        ),
      },
    },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((user) => [user.id, user]));
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    publishedAt: row.publishedAt.toISOString(),
    publishedBy: row.publishedById
      ? (names.get(row.publishedById) ?? { id: row.publishedById, name: null })
      : null,
  }));
}

export async function getTopicRevision(id: string, actorId?: ContentReader) {
  const row = await getDb().topicRevision.findUnique({
    where: { id },
    include: { topic: { select: { subjectId: true } } },
  });
  if (!row) throw notFound();
  await authorizeSubject(row.topic.subjectId, actorId);
  const publisher = row.publishedById
    ? await getDb().user.findUnique({
        where: { id: row.publishedById },
        select: { id: true, name: true },
      })
    : null;
  return {
    parsed: parseTopic(row.contentMd),
    id: row.id,
    version: row.version,
    title: row.title,
    contentMd: row.contentMd,
    gapExercises: gapExercisesSchema.parse(row.gapExercises),
    questions: row.questions as unknown as QuestionDTO[],
    publishedAt: row.publishedAt.toISOString(),
    publishedBy: publisher,
  };
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

export async function getSection(id: string, actorId: ContentReader) {
  const row = await getDb().section.findUnique({ where: { id } });
  if (!row) throw notFound();
  await authorizeSubject(row.subjectId, actorId);
  return row;
}
export async function getQuestion(id: string, actorId: ContentReader) {
  const row = await getDb().question.findFirst({
    where: { id, archivedAt: null, draftDeleted: false },
    include: { topic: { select: { subjectId: true } } },
  });
  if (!row) throw notFound();
  await authorizeSubject(row.topic.subjectId, actorId);
  return questionDTO(row);
}
