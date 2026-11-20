import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, afterAll, expect, it, vi } from "vitest";
import { getDb } from "../../lib/db";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import { recordInitialTopicRevision } from "../../lib/content/drafts";
import * as content from "../../lib/content/service";
import * as lessons from "../../lib/lessons/service";
import { getReviewQueue, revealCard, rateCard } from "../../lib/srs/service";
import { MockLLMProvider } from "../../lib/llm";
import { indexTopic } from "../../lib/tutor/indexing";
import { prepareTurn, executeTurn } from "../../lib/tutor/service";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
import type { TopicDTO, QuestionDTO } from "../../lib/content/types";
import type { TopicInput, QuestionInput } from "../../lib/content/validation";
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    DEFAULT_SETTINGS[key],
}));
vi.mock("../../lib/content/jobs", () => ({
  getContentQueue: vi.fn(async () => ({})),
  enqueuePublication: vi.fn(async () => {}),
}));
const db = getDb();
let f: LessonFixture,
  student: string,
  teacher: string,
  outsider: string,
  head: string;
const users: string[] = [];
const fields = (t: TopicDTO): TopicInput => ({
  title: t.title,
  slug: t.slug,
  sectionId: t.sectionId,
  order: t.order,
  isFree: t.isFree,
  contentMd: t.contentMd,
  gapExercises: t.gapExercises,
  readingMinutes: t.readingMinutes,
  referencesMd: t.referencesMd,
  authorName: t.authorName,
  reviewerName: t.reviewerName,
  reviewed: !t.needsExpertReview,
});
const question = (q: QuestionDTO): QuestionInput => ({
  answerType: q.answerType,
  stem: q.stem,
  options: q.options,
  correctOptionIds: q.correctOptionIds,
  acceptedAnswers: q.acceptedAnswers,
  explanation: q.explanation,
  sourceBlockKey: q.sourceBlockKey,
  isDiagnostic: q.isDiagnostic,
  order: q.order,
});
async function publish(t: TopicDTO) {
  t = await content.updateTopic(
    t.id,
    t.editRevision,
    { ...fields(t), reviewed: true },
    teacher,
  );
  t = await content.setTopicStatus(t.id, t.editRevision, "REVIEW", teacher);
  return content.publishTopic(t.id, t.editRevision, teacher);
}
beforeEach(async () => {
  f = await createLessonFixture("stage12");
  for (const role of ["USER", "EDITOR", "EDITOR", "EDITOR"] as const) {
    const u = await db.user.create({
      data: {
        role,
        name: `Fixture ${role}`,
        consentPdAt: new Date(),
        emailVerifiedAt: new Date(),
      },
    });
    users.push(u.id);
  }
  [student, teacher, outsider, head] = users;
  await db.roleAssignment.create({
    data: {
      userId: head,
      role: "DEPARTMENT_HEAD",
      departmentId: f.subject.departmentId,
      scopeKey: "department:" + f.subject.departmentId,
    },
  });
  await db.roleAssignment.create({
    data: {
      userId: teacher,
      subjectId: f.subject.id,
      assignedById: teacher,
      role: "AUTHOR",
      scopeKey: "subject:" + f.subject.id,
    },
  });
});
afterEach(async () => {
  await cleanupLessonFixture(f, [], users.splice(0));
});
afterAll(async () => {
  await db.$disconnect();
});
it("keeps published text, cards and tutor sources until the atomic publication", async () => {
  const actor = { userId: student },
    old = await lessons.loadLesson(f.free.id, actor);
  const gap = f.free.gap_topicId[0];
  await lessons.answerGap(
    gap.id,
    old.gaps
      .find((g) => g.id === gap.id)!
      .options.find((o) => o.text !== gap.answer)!.id,
    old.version,
    actor,
  );
  let t = await content.getTopic(f.free.id, undefined, teacher);
  const oldContent = f.free.contentMd;
  t = await content.updateTopic(
    t.id,
    t.editRevision,
    {
      ...fields(t),
      title: "Новый заголовок",
      contentMd: t.contentMd + "\n\nНЕОПУБЛИКОВАННЫЙ_АБЗАЦ.",
      reviewed: false,
    },
    teacher,
  );
  expect(t).toMatchObject({
    status: "PUBLISHED",
    draftState: "DRAFT",
    version: 1,
    draftUpdatedBy: { id: teacher },
  });
  const live = await db.topic.findUniqueOrThrow({ where: { id: t.id } });
  expect(live.contentMd).toBe(oldContent);
  expect(live.title).toBe(f.free.title);
  expect(live.needsExpertReview).toBe(false);
  expect((await lessons.loadLesson(t.id, actor)).blocks).toEqual(old.blocks);
  const queue = await getReviewQueue(student),
    card = queue.cards[0];
  expect(card).toBeDefined();
  await revealCard(student, card.id, card.revision, card.topicVersion);
  await rateCard(student, card.id, card.revision, card.topicVersion, "GOOD");
  await indexTopic({ topicId: t.id, subjectId: t.subjectId, version: 1 });
  const chunks = await db.contentChunk.findMany({ where: { topicId: t.id } });
  expect(JSON.stringify(chunks)).not.toContain("НЕОПУБЛИКОВАННЫЙ_АБЗАЦ");
  const turn = await prepareTurn(
    {
      kind: "question",
      text: "Первый выбор",
      topicId: t.id,
      requestId: randomUUID(),
    },
    actor,
  );
  const provider = new MockLLMProvider(1536);
  const chat = vi.spyOn(provider, "chat");
  const reply = await executeTurn(turn, () => {}, undefined, provider);
  expect(chat).toHaveBeenCalledOnce();
  expect(JSON.stringify(chat.mock.calls[0][0])).not.toContain(
    "НЕОПУБЛИКОВАННЫЙ_АБЗАЦ",
  );
  expect(reply.message.citations[0].topicVersion).toBe(1);
  t = await publish(t);
  expect(t).toMatchObject({
    status: "PUBLISHED",
    draftState: "CLEAN",
    version: 2,
  });
  expect(
    JSON.stringify((await lessons.loadLesson(t.id, actor)).blocks),
  ).toContain("НЕОПУБЛИКОВАННЫЙ_АБЗАЦ");
  const history = await content.listTopicRevisions(t.id, teacher);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    version: 2,
    publishedBy: { id: teacher },
  });
  const snapshot = await content.getTopicRevision(history[0].id, teacher);
  expect(snapshot.contentMd).toBe(t.contentMd);
  expect(snapshot.questions.map((q) => q.stem)).toEqual(
    t.questions.map((q) => q.stem),
  );
  expect(
    (await content.publishTopic(t.id, t.editRevision, teacher)).version,
  ).toBe(2);
  expect(await db.topicRevision.count({ where: { topicId: t.id } })).toBe(1);
});
it("stages question additions, edits and deletion; only publication changes tests, grading and cards", async () => {
  let t = await content.getTopic(f.free.id, undefined, teacher);
  const edited = t.questions[0],
    removed = t.questions[1],
    actor = { userId: student };
  const run = await lessons.startTest(t.id, t.version, actor);
  await lessons.answerQuestion(t.id, run.runId!, removed.id, "a", actor);
  const card = await db.card.findUniqueOrThrow({
    where: { userId_questionId: { userId: student, questionId: removed.id } },
  });
  t = await content.updateQuestion(
    edited.id,
    t.editRevision,
    {
      ...question(edited),
      stem: "Изменённый вопрос",
      correctOptionIds: ["a"],
      explanation: "Новый эталон",
    },
    teacher,
  );
  t = await content.createQuestion(
    t.id,
    t.editRevision,
    {
      ...question(edited),
      stem: "Новый вопрос",
      sourceBlockKey: null,
      order: 99,
    },
    teacher,
  );
  const newId = t.questions.find((q) => q.stem === "Новый вопрос")!.id;
  t = await content.deleteQuestion(removed.id, t.editRevision, teacher);
  expect(t.questions).toHaveLength(5);
  expect(t.questions.some((q) => q.id === removed.id)).toBe(false);
  const pending = await lessons.loadLesson(t.id, actor);
  expect(pending.test!.questions.map((q) => q.id)).toEqual(
    run.questions.map((q) => q.id),
  );
  expect(pending.test!.questions.find((q) => q.id === edited.id)!.stem).toBe(
    edited.stem,
  );
  expect(JSON.stringify(pending)).not.toContain("Новый эталон");
  await expect(
    lessons.answerQuestion(t.id, run.runId!, newId, "a", actor),
  ).rejects.toMatchObject({ status: 422 });
  expect(
    (
      await lessons.answerQuestion(t.id, run.runId!, edited.id, "b", actor)
    ).test!.questions.find((q) => q.id === edited.id)!.feedback!.correct,
  ).toBe(true);
  expect(
    (await db.card.findUniqueOrThrow({ where: { id: card.id } })).suspended,
  ).toBe(false);
  t = await publish(t);
  const published = await lessons.loadLesson(t.id, actor);
  expect(published.test!.questions.some((q) => q.id === newId)).toBe(true);
  expect(published.test!.questions.some((q) => q.id === removed.id)).toBe(
    false,
  );
  expect(published.test!.questions.find((q) => q.id === edited.id)!.stem).toBe(
    "Изменённый вопрос",
  );
  expect(
    (await db.card.findUniqueOrThrow({ where: { id: card.id } })).suspended,
  ).toBe(true);
  expect(
    await db.questionAttempt.count({ where: { questionId: removed.id } }),
  ).toBe(1);
  const newer = await lessons.startTest(t.id, t.version, actor);
  expect(
    (
      await lessons.answerQuestion(t.id, newer.runId!, edited.id, "a", actor)
    ).test!.questions.find((q) => q.id === edited.id)!.feedback!.correct,
  ).toBe(true);
});
it("discards text and question changes, deletes unpublished questions and preserves immediate structure", async () => {
  let t = await content.getTopic(f.free.id, undefined, teacher);
  const initial = fields(t),
    q = t.questions[0];
  t = await content.updateTopic(
    t.id,
    t.editRevision,
    {
      ...initial,
      title: "Не публиковать",
      contentMd: t.contentMd + "\n\nЧерновик.",
      order: 42,
      isFree: false,
      reviewed: false,
    },
    teacher,
  );
  t = await content.updateQuestion(
    q.id,
    t.editRevision,
    { ...question(q), stem: "Не публиковать вопрос" },
    teacher,
  );
  t = await content.deleteQuestion(t.questions[1].id, t.editRevision, teacher);
  t = await content.createQuestion(
    t.id,
    t.editRevision,
    { ...question(q), stem: "Удалить черновик", sourceBlockKey: null },
    teacher,
  );
  const pending = t.questions.find((q) => q.stem === "Удалить черновик")!.id;
  t = await content.discardTopicChanges(t.id, t.editRevision, teacher);
  expect(fields(t)).toEqual({ ...initial, order: 42, isFree: false });
  expect(t.draftState).toBe("CLEAN");
  expect(t.questions).toHaveLength(5);
  expect(t.questions[0].stem).toBe(q.stem);
  expect(await db.question.count({ where: { id: pending } })).toBe(0);
  expect(
    (await db.question.findMany({ where: { topicId: t.id } })).every(
      (q) => q.draft === null && !q.draftDeleted,
    ),
  ).toBe(true);
});
it("unpublishes separately, leaves the draft intact and returns cards on republication", async () => {
  const actor = { userId: student },
    gap = f.free.gap_topicId[0];
  const lesson = await lessons.loadLesson(f.free.id, actor);
  await lessons.answerGap(
    gap.id,
    lesson.gaps
      .find((g) => g.id === gap.id)!
      .options.find((o) => o.text !== gap.answer)!.id,
    1,
    actor,
  );
  let t = await content.getTopic(f.free.id, undefined, teacher);
  const original = t.contentMd;
  t = await content.updateTopic(
    t.id,
    t.editRevision,
    { ...fields(t), contentMd: t.contentMd + "\n\nПравки.", reviewed: false },
    teacher,
  );
  await expect(
    content.unpublishTopic(t.id, t.editRevision, teacher),
  ).rejects.toMatchObject({ status: 403 });
  t = await content.unpublishTopic(t.id, t.editRevision, head);
  expect(t.status).toBe("DRAFT");
  expect(t.draftState).toBe("DRAFT");
  expect(t.contentMd).toContain("Правки.");
  await expect(lessons.loadLesson(t.id, actor)).rejects.toMatchObject({
    status: 404,
  });
  expect((await getReviewQueue(student)).cards).toHaveLength(0);
  await expect(
    content.updateTopic(
      t.id,
      t.editRevision,
      { ...fields(t), slug: "broken" },
      teacher,
    ),
  ).rejects.toMatchObject({ status: 422 });
  t = await content.discardTopicChanges(t.id, t.editRevision, teacher);
  expect(t.contentMd).toBe(original);
  t = await content.publishTopic(t.id, t.editRevision, teacher);
  expect(t.version).toBe(2);
  expect((await getReviewQueue(student)).cards).toHaveLength(1);
  await expect(
    content.updateTopic(
      t.id,
      t.editRevision,
      { ...fields(t), slug: "broken" },
      teacher,
    ),
  ).rejects.toMatchObject({ status: 422 });
});
it("creates immutable snapshots for each publication and restricts history and mutations to staff scope", async () => {
  let t = await publish(await content.getTopic(f.free.id, undefined, teacher));
  const first = (await content.listTopicRevisions(t.id, teacher))[0];
  const snapshot = await content.getTopicRevision(first.id, teacher);
  const q = t.questions[0];
  t = await content.updateQuestion(
    q.id,
    t.editRevision,
    { ...question(q), stem: "Следующая версия" },
    teacher,
  );
  t = await publish(t);
  expect(
    (await content.listTopicRevisions(t.id, teacher)).map((r) => r.version),
  ).toEqual([3, 2]);
  expect(await content.getTopicRevision(first.id, teacher)).toEqual(snapshot);
  for (const actor of [student, outsider]) {
    const status = actor === student ? 403 : 404;
    await expect(content.listTopicRevisions(t.id, actor)).rejects.toMatchObject(
      { status },
    );
    await expect(
      content.getTopicRevision(first.id, actor),
    ).rejects.toMatchObject({ status });
    await expect(
      content.discardTopicChanges(t.id, t.editRevision, actor),
    ).rejects.toMatchObject({ status });
    await expect(
      content.unpublishTopic(t.id, t.editRevision, actor),
    ).rejects.toMatchObject({ status });
  }
  await expect(
    content.updateTopic(t.id, t.editRevision - 1, fields(t), teacher),
  ).rejects.toMatchObject({ status: 409, code: "stale" });
  await expect(
    content.unpublishTopic(t.id, t.editRevision, teacher),
  ).rejects.toMatchObject({ status: 403 });
  t = await content.unpublishTopic(t.id, t.editRevision, head);
  await expect(
    content.deleteTopic(t.id, t.editRevision, teacher),
  ).rejects.toMatchObject({ status: 409 });
});

it("records an initial preview publication once and never replaces it with a draft", async () => {
  await recordInitialTopicRevision(db, f.free.id);
  const initial = (await content.listTopicRevisions(f.free.id, teacher))[0];
  const snapshot = await content.getTopicRevision(initial.id, teacher);
  expect(snapshot.version).toBe(1);
  expect(snapshot.questions).toHaveLength(5);
  expect(snapshot.questions[0].id).toBe(
    f.free.question_topicId.find((q) => q.order === 0)!.id,
  );
  let topic = await content.getTopic(f.free.id, undefined, teacher);
  topic = await content.updateTopic(
    topic.id,
    topic.editRevision,
    { ...fields(topic), title: "Only draft" },
    teacher,
  );
  await recordInitialTopicRevision(db, topic.id);
  expect(await content.getTopicRevision(initial.id, teacher)).toEqual(snapshot);
  expect(await content.listTopicRevisions(topic.id, teacher)).toHaveLength(1);
});
