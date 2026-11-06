import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getDb } from "../../lib/db";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import * as service from "../../lib/content/service";
import * as jobs from "../../lib/content/jobs";
import { parseTopic } from "../../lib/content/parse";
import type {
  TopicInput,
  SubjectInput,
  QuestionInput,
} from "../../lib/content/validation";
import type { TopicDTO } from "../../lib/content/types";
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    DEFAULT_SETTINGS[key],
}));
const db = getDb();
const prefix = `content-${randomUUID()}`;
const subjectIds: string[] = [];
const topicIds: string[] = [];
let userId: string | null = null;
function markdown(count = 10) {
  return `## Проверка\n\n${Array.from({ length: count }, (_, i) => `Фрагмент ${i} [[ответ-${i}|ошибка-${i}]].`).join("\n\n")}`;
}
const baseFields = (contentMd = markdown()): TopicInput => ({
  title: "Тестовая тема",
  slug: `topic-${randomUUID()}`,
  sectionId: null,
  order: 0,
  isFree: true,
  contentMd,
  readingMinutes: 5,
  authorName: "Автор фикстуры",
  reviewerName: "Рецензент фикстуры",
  referencesMd: "Синтетический материал для теста, не медицинское содержание.",
  reviewed: false,
});
const toInput = (row: TopicDTO): TopicInput => ({
  title: row.title,
  slug: row.slug,
  sectionId: row.sectionId,
  order: row.order,
  isFree: row.isFree,
  contentMd: row.contentMd,
  readingMinutes: row.readingMinutes,
  authorName: row.authorName,
  reviewerName: row.reviewerName,
  referencesMd: row.referencesMd,
  reviewed: !row.needsExpertReview,
});
async function subject() {
  const input: SubjectInput = {
    title: prefix,
    slug: `subject-${randomUUID()}`,
    shortDescription: "Синтетический предмет",
    descriptionMd: null,
    courses: [1],
    order: 0,
    status: "PUBLISHED",
    seoTitle: null,
    seoDescription: null,
  };
  const row = await service.createSubject(input);
  subjectIds.push(row.id);
  return row;
}
function question(row: TopicDTO, index = 0): QuestionInput {
  return {
    stem: `Синтетический вопрос ${index}`,
    options: [
      { id: "a", text: "Первый" },
      { id: "b", text: "Второй" },
      { id: "c", text: "Третий" },
    ],
    correctOptionIds: ["b"],
    explanation: "Объяснение тестовой фикстуры",
    sourceBlockKey:
      parseTopic(row.contentMd).blocks.find((b) => b.kind !== "heading")
        ?.blockKey ?? null,
    isDiagnostic: index < 3,
    order: index,
  };
}
async function draft() {
  const s = await subject();
  let row = await service.createTopic(s.id, baseFields());
  topicIds.push(row.id);
  for (let i = 0; i < 5; i++)
    row = await service.createQuestion(
      row.id,
      row.editRevision,
      question(row, i),
    );
  return row;
}
async function reviewed(row: TopicDTO, changes: Partial<TopicInput> = {}) {
  row = await service.updateTopic(row.id, row.editRevision, {
    ...toInput(row),
    ...changes,
    reviewed: true,
  });
  return service.setTopicStatus(row.id, row.editRevision, "REVIEW");
}
async function fixtureUser() {
  if (!userId)
    userId = (
      await db.user.create({
        data: { email: `${prefix}@example.test`, name: "Контент-тест" },
      })
    ).id;
  return userId;
}
afterAll(async () => {
  vi.restoreAllMocks();
  const queue = await jobs.getContentQueue();
  for (const topicId of topicIds) {
    const rows = await db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM pgboss.job WHERE name=${jobs.CONTENT_INDEX_QUEUE} AND data->>'topicId'=${topicId}`;
    if (rows.length)
      await queue.deleteJob(
        jobs.CONTENT_INDEX_QUEUE,
        rows.map((r) => r.id),
      );
  }
  if (userId) {
    await db.reviewLog.deleteMany({ where: { card: { userId } } });
    await db.card.deleteMany({ where: { userId } });
    await db.gapAnswer.deleteMany({ where: { userId } });
    await db.questionAttempt.deleteMany({ where: { testRun: { userId } } });
    await db.testRun.deleteMany({ where: { userId } });
    await db.topicProgress.deleteMany({ where: { userId } });
  }
  await db.contentChunk.deleteMany({ where: { topicId: { in: topicIds } } });
  await db.question.deleteMany({ where: { topicId: { in: topicIds } } });
  await db.gap.deleteMany({ where: { topicId: { in: topicIds } } });
  await db.topic.deleteMany({ where: { id: { in: topicIds } } });
  await db.section.deleteMany({ where: { subjectId: { in: subjectIds } } });
  await db.subject.deleteMany({ where: { id: { in: subjectIds } } });
  if (userId) await db.user.delete({ where: { id: userId } });
  await jobs.closeContentQueue();
  await db.$disconnect();
});
describe("content publication with PostgreSQL and pg-boss", () => {
  it("publishes 10 gaps and 5 questions atomically and is idempotent on a repeat request", async () => {
    let row = await reviewed(await draft());
    row = await service.publishTopic(row.id, row.editRevision);
    expect(row.status).toBe("PUBLISHED");
    expect(row.version).toBe(1);
    const gaps = await db.gap.findMany({
      where: { topicId: row.id },
      orderBy: { gapKey: "asc" },
    });
    expect(gaps).toHaveLength(10);
    const repeated = await service.publishTopic(row.id, row.editRevision);
    expect(repeated.version).toBe(1);
    expect(
      (
        await db.gap.findMany({
          where: { topicId: row.id },
          orderBy: { gapKey: "asc" },
        })
      ).map((g) => g.id),
    ).toEqual(gaps.map((g) => g.id));
    const queued = await db.$queryRaw<
      { data: { topicId: string; version: number } }[]
    >`SELECT data FROM pgboss.job WHERE name=${jobs.CONTENT_INDEX_QUEUE} AND data->>'topicId'=${row.id}`;
    expect(queued).toHaveLength(1);
    expect(queued[0].data).toMatchObject({ topicId: row.id, version: 1 });
  });
  it("blocks invalid Markdown with line numbers without changing publication or creating gaps", async () => {
    let row = await draft();
    row = await reviewed(row, {
      contentMd: "## Проверка\n\nОшибка [[ответ|]].",
    });
    await expect(
      service.publishTopic(row.id, row.editRevision),
    ).rejects.toMatchObject({
      status: 422,
      issues: [expect.objectContaining({ line: 3, code: "empty_option" })],
    });
    expect((await service.getTopic(row.id)).version).toBe(0);
    expect(await db.gap.count({ where: { topicId: row.id } })).toBe(0);
  });
  it("requires expert confirmation, review status and question count", async () => {
    let row = await draft();
    row = await service.setTopicStatus(row.id, row.editRevision, "REVIEW");
    await expect(
      service.publishTopic(row.id, row.editRevision),
    ).rejects.toThrow("экспертом");
    row = await service.updateTopic(row.id, row.editRevision, {
      ...toInput(row),
      reviewed: true,
    });
    row = await service.setTopicStatus(row.id, row.editRevision, "DRAFT");
    await expect(
      service.publishTopic(row.id, row.editRevision),
    ).rejects.toThrow("Сначала отправьте");
    row = await service.deleteQuestion(row.questions[0].id, row.editRevision);
    row = await reviewed(row);
    await expect(
      service.publishTopic(row.id, row.editRevision),
    ).rejects.toThrow("от 5 до 15");
  });
  it("preserves answers and cards, archives missing gaps and restores their original IDs", async () => {
    let row = await reviewed(await draft());
    row = await service.publishTopic(row.id, row.editRevision);
    const original = await db.gap.findMany({
      where: { topicId: row.id },
      orderBy: { order: "asc" },
    });
    const userId = await fixtureUser();
    await db.gapAnswer.create({
      data: {
        userId,
        gapId: original[0].id,
        chosen: "ошибка",
        isCorrect: false,
      },
    });
    const card = await db.card.create({
      data: {
        userId,
        source: "GAP",
        gapId: original[0].id,
        subjectId: row.subjectId,
        topicId: row.id,
        dueAt: new Date(),
      },
    });
    row = await reviewed(row, {
      contentMd: markdown().replace("ошибка-0", "другой-дистрактор"),
    });
    expect(row.status).toBe("REVIEW");
    row = await service.publishTopic(row.id, row.editRevision);
    expect(
      (
        await db.gap.findMany({
          where: { topicId: row.id },
          orderBy: { order: "asc" },
        })
      ).map((g) => g.id),
    ).toEqual(original.map((g) => g.id));
    row = await reviewed(row, {
      contentMd: markdown().replace("Фрагмент 0 [[ответ-0|ошибка-0]].\n\n", ""),
    });
    row = await service.publishTopic(row.id, row.editRevision);
    expect(
      (await db.gap.findUniqueOrThrow({ where: { id: original[0].id } }))
        .archivedAt,
    ).not.toBeNull();
    expect(
      (await db.card.findUniqueOrThrow({ where: { id: card.id } })).suspended,
    ).toBe(true);
    expect(await db.gapAnswer.count({ where: { gapId: original[0].id } })).toBe(
      1,
    );
    row = await reviewed(row, { contentMd: markdown() });
    await service.publishTopic(row.id, row.editRevision);
    expect(
      (await db.gap.findUniqueOrThrow({ where: { id: original[0].id } }))
        .archivedAt,
    ).toBeNull();
    expect(
      (await db.card.findUniqueOrThrow({ where: { id: card.id } })).suspended,
    ).toBe(false);
  });
  it("archives questions with attempts and suspends their cards without deleting history", async () => {
    let row = await reviewed(await draft());
    row = await service.publishTopic(row.id, row.editRevision);
    const q = row.questions[0],
      userId = await fixtureUser();
    const run = await db.testRun.create({
      data: {
        userId,
        subjectId: row.subjectId,
        topicId: row.id,
        mode: "TOPIC",
        total: 5,
      },
    });
    await db.questionAttempt.create({
      data: {
        testRunId: run.id,
        questionId: q.id,
        chosenOptionIds: ["a"],
        isCorrect: false,
      },
    });
    const card = await db.card.create({
      data: {
        userId,
        source: "QUESTION",
        questionId: q.id,
        subjectId: row.subjectId,
        topicId: row.id,
        dueAt: new Date(),
      },
    });
    row = await service.deleteQuestion(q.id, row.editRevision);
    expect(row.status).toBe("DRAFT");
    expect(row.needsExpertReview).toBe(true);
    expect(
      (await db.question.findUniqueOrThrow({ where: { id: q.id } })).archivedAt,
    ).not.toBeNull();
    expect(
      (await db.card.findUniqueOrThrow({ where: { id: card.id } })).suspended,
    ).toBe(true);
    expect(
      await db.questionAttempt.count({ where: { questionId: q.id } }),
    ).toBe(1);
  });
  it("rejects stale parallel saves and cross-subject section/source references", async () => {
    let row = await draft();
    const before = row.editRevision;
    const saves = await Promise.allSettled([
      service.updateTopic(row.id, before, { ...toInput(row), title: "Первый" }),
      service.updateTopic(row.id, before, { ...toInput(row), title: "Второй" }),
    ]);
    expect(saves.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(saves.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "stale", status: 409 },
    });
    row = await service.getTopic(row.id);
    const other = await subject(),
      section = await service.createSection(other.id, {
        title: "Чужой раздел",
        order: 0,
      });
    await expect(
      service.updateTopic(row.id, row.editRevision, {
        ...toInput(row),
        sectionId: section.id,
      }),
    ).rejects.toThrow("принадлежать");
    await expect(
      service.createQuestion(row.id, row.editRevision, {
        ...question(row),
        sourceBlockKey: "missing-block",
      }),
    ).rejects.toThrow("источник");
  });
  it("rolls back publication if the indexing job cannot be committed", async () => {
    let row = await reviewed(await draft());
    const mock = vi
      .spyOn(jobs, "enqueuePublication")
      .mockRejectedValueOnce(new Error("Synthetic queue failure"));
    await expect(
      service.publishTopic(row.id, row.editRevision),
    ).rejects.toThrow("Synthetic queue failure");
    mock.mockRestore();
    expect((await service.getTopic(row.id)).status).toBe("REVIEW");
    expect(await db.gap.count({ where: { topicId: row.id } })).toBe(0);
    row = await service.publishTopic(row.id, row.editRevision);
    expect(row.version).toBe(1);
  });
  it("rolls back an attempted deletion when learner progress references the topic", async () => {
    const row = await draft(),
      userId = await fixtureUser();
    await db.topicProgress.create({
      data: { userId, topicId: row.id, gapsAnswered: 1 },
    });
    await expect(
      service.deleteTopic(row.id, row.editRevision),
    ).rejects.toMatchObject({ code: "P2003" });
    expect((await service.getTopic(row.id)).questions).toHaveLength(5);
    expect(await db.topicProgress.count({ where: { topicId: row.id } })).toBe(
      1,
    );
  });
});
