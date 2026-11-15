import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, afterAll, it, expect, vi } from "vitest";
import { anonymizeAccount } from "../../lib/auth/deletion";
import { getDb } from "../../lib/db";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import { currentLegal } from "../../lib/auth/legal";
import {
  createLessonFixture,
  cleanupLessonFixture,
  addMixedExercises,
  type LessonFixture,
} from "../helpers/lesson-fixture";
import * as lessons from "../../lib/lessons/service";
import { gapHistory } from "../../lib/lessons/history";
import { studentProgress } from "../../lib/progress/student";
import { progressSummary } from "../../lib/progress/summary";
import { studentOverview } from "../../lib/admin/cabinet";
import { revealCard, rateCard, getReviewSummary } from "../../lib/srs/service";
import { recordInitialTopicRevision } from "../../lib/content/drafts";
import * as content from "../../lib/content/service";
import { ensureDemoStudents } from "../../scripts/preview/students-demo";
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    DEFAULT_SETTINGS[key],
}));
vi.mock("../../lib/content/jobs", () => ({
  getContentQueue: vi.fn(async () => ({})),
  enqueuePublication: vi.fn(async () => {}),
}));
const db = getDb(),
  users: string[] = [],
  demos: string[] = [];
let f: LessonFixture,
  admin: string,
  student: string,
  teacher: string,
  other: string,
  prefix: string;
beforeEach(async () => {
  f = await createLessonFixture("progress");
  prefix = `progress-${randomUUID()}`;
  const legal = await currentLegal();
  for (const [index, role] of (
    ["ADMIN", "USER", "EDITOR", "USER"] as const
  ).entries()) {
    const user = await db.user.create({
      data: {
        role,
        name: `${prefix}-${index}`,
        email: `${prefix}-${index}@example.test`,
        createdAt: new Date(Date.now() - 30 * 86400000),
        emailVerifiedAt: new Date(),
        consentPdAt: new Date(),
        consentPdVersion: legal.consent.version,
        offerVersion: legal.offer.version,
      },
    });
    users.push(user.id);
  }
  [admin, student, teacher, other] = users;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanupLessonFixture(f, demos.splice(0), users.splice(0));
});
afterAll(async () => {
  await db.$disconnect();
});
async function answer(
  userId = student,
  correct = false,
  practice = false,
  gapIndex = 0,
) {
  const actor = { userId },
    lesson = await lessons.loadLesson(f.free.id, actor),
    gap = f.free.gap_topicId.find((g) => g.order === gapIndex)!,
    view = lesson.gaps.find((g) => g.id === gap.id)!;
  return lessons.answerGap(
    gap.id,
    view.options.find((o) => (o.text === gap.answer) === correct)!.id,
    lesson.version,
    actor,
    practice,
  );
}
async function complete() {
  await answer(student, false);
  await answer(student, true, false, 1);
  const test = await lessons.startTest(f.free.id, 1, { userId: student });
  for (const [i, q] of test.questions.entries())
    await lessons.answerQuestion(
      f.free.id,
      test.runId!,
      q.id,
      i === 0 ? "a" : "b",
      { userId: student },
    );
  return test;
}
it("records the first answer and explicit practice, ignoring first-answer replays, guests and rejected submissions", async () => {
  const initial = await answer(student, false);
  const first = await db.gapAnswer.findFirstOrThrow({
    where: { userId: student },
  });
  const practice = await answer(student, true, true);
  expect(practice.feedback.correct).toBe(true);
  const replay = await answer(student, true);
  expect(replay.feedback).toEqual(initial.feedback);
  const attempts = await db.gapAttempt.findMany({
    where: { userId: student },
    orderBy: { createdAt: "asc" },
  });
  expect(attempts.map((a) => [a.isCorrect, a.practice])).toEqual([
    [false, false],
    [true, true],
  ]);
  expect(await db.gapAnswer.findUnique({ where: { id: first.id } })).toEqual(
    first,
  );
  const demo = await db.demoSession.create({
    data: { anonId: randomUUID(), stepsCompleted: [] },
  });
  demos.push(demo.id);
  const guest = { demoSessionId: demo.id },
    lesson = await lessons.loadLesson(f.free.id, guest);
  await lessons.answerGap(
    lesson.gaps[0].id,
    lesson.gaps[0].options[0].id,
    1,
    guest,
  );
  expect(
    await db.gapAttempt.count({ where: { gapId: lesson.gaps[0].id } }),
  ).toBe(2);
  await expect(
    lessons.answerGap(lesson.gaps[0].id, "not-an-option", 1, {
      userId: student,
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    lessons.answerGap(lesson.gaps[0].id, lesson.gaps[0].options[0].id, 99, {
      userId: student,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await db.gapAttempt.count({ where: { userId: student } })).toBe(2);
});
it("records the first answer as non-practice even when the request sets practice=true", async () => {
  const initial = await answer(student, true, true);
  const first = await db.gapAnswer.findFirstOrThrow({
    where: { userId: student },
  });
  const attempts = await db.gapAttempt.findMany({
    where: { userId: student },
  });
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({
    gapId: first.gapId,
    userId: student,
    topicVersion: f.free.version,
    chosenValues: first.chosenValues,
    chosenText: null,
    isCorrect: first.isCorrect,
    practice: false,
  });
  expect(initial.feedback).toMatchObject({
    chosen: first.chosen,
    chosenValues: first.chosenValues,
    correct: true,
  });
  const replay = await answer(student, false);
  expect(replay.feedback).toEqual(initial.feedback);
  expect(await db.gapAttempt.count({ where: { userId: student } })).toBe(1);
  expect(await db.gapAnswer.findUnique({ where: { id: first.id } })).toEqual(
    first,
  );
});
it("records a single non-practice attempt for concurrent double submissions and returns the same first result to both", async () => {
  const actor = { userId: student },
    lesson = await lessons.loadLesson(f.free.id, actor),
    gap = lesson.gaps[0],
    wrong = gap.options.find((o) => o.text.startsWith("неверный"))!,
    right = gap.options.find((o) => o.text.startsWith("верный"))!;
  const responses = await Promise.all([
    lessons.answerGap(gap.id, wrong.id, lesson.version, actor),
    lessons.answerGap(gap.id, right.id, lesson.version, actor),
  ]);
  const firsts = await db.gapAnswer.findMany({
    where: { userId: student, gapId: gap.id },
  });
  const attempts = await db.gapAttempt.findMany({
    where: { userId: student, gapId: gap.id },
  });
  expect(firsts).toHaveLength(1);
  expect(attempts).toHaveLength(1);
  const first = firsts[0];
  expect(attempts[0]).toMatchObject({
    gapId: first.gapId,
    userId: student,
    topicVersion: lesson.version,
    chosenValues: first.chosenValues,
    isCorrect: first.isCorrect,
    practice: false,
  });
  expect(responses[0].feedback).toEqual(responses[1].feedback);
  for (const response of responses) {
    expect(response.feedback).toMatchObject({
      chosen: first.chosen,
      chosenValues: first.chosenValues,
      correct: first.isCorrect,
    });
    expect(response.progress).toMatchObject({
      answered: 1,
      correct: first.isCorrect ? 1 : 0,
    });
  }
});
it("returns admin summaries/cards and audits each card request; totals match the student's cabinet and review summary", async () => {
  await complete();
  const now = new Date(),
    overview = await studentOverview(student, now),
    queue = await getReviewSummary(student, now);
  const summary = await progressSummary(
    { viewerId: admin, q: `${prefix}-1` },
    now,
  );
  expect(summary.items).toHaveLength(1);
  expect(summary.items[0]).toMatchObject({
    id: student,
    completed: 1,
    average: 0.8,
    due: queue.dueCount,
  });
  const card = await studentProgress(student, { viewerId: admin }, now);
  expect(card.summary.completed).toBe(overview.subjects[0].completed);
  expect(card.summary.average).toBe(overview.subjects[0].average);
  expect(
    card.topics.find((t) => t.id === f.free.id)!.tests[0].answers[0],
  ).toMatchObject({
    isCorrect: false,
    chosen: ["Вариант А"],
    correct: ["Вариант Б"],
  });
  expect(
    card.topics.find((t) => t.id === f.free.id)!.gaps[0].first!.correct,
  ).toBe(false);
  expect(card.activity.reduce((sum, d) => sum + d.count, 0)).toBeGreaterThan(5);
  await studentProgress(
    student,
    { viewerId: admin, subjectId: f.subject.id },
    now,
  );
  expect(
    (
      await db.studentDataAccess.findMany({
        where: { studentId: student },
        orderBy: { createdAt: "asc" },
      })
    ).map((a) => [a.viewerId, a.subjectId, a.view]),
  ).toEqual([
    [admin, null, "student_card"],
    [admin, f.subject.id, "student_card"],
  ]);
});
it("denies editors, users and guests with 404 without logging or leaking data, including their own id", async () => {
  for (const viewerId of [teacher, student, other, null]) {
    await expect(progressSummary({ viewerId })).rejects.toMatchObject({
      status: 404,
    });
    await expect(studentProgress(student, { viewerId })).rejects.toMatchObject({
      status: 404,
    });
    if (viewerId)
      await expect(
        studentProgress(viewerId, { viewerId }),
      ).rejects.toMatchObject({ status: 404 });
  }
  expect(
    await db.studentDataAccess.count({ where: { studentId: student } }),
  ).toBe(0);
  await db.user.update({
    where: { id: admin },
    data: { blockedAt: new Date() },
  });
  await expect(
    studentProgress(student, { viewerId: admin }),
  ).rejects.toMatchObject({ status: 404 });
});
it("masks deleted student contacts and excludes them from the list", async () => {
  await answer();
  const original = await db.user.update({
    where: { id: student },
    data: { deletedAt: new Date() },
  });
  expect(
    (await progressSummary({ viewerId: admin, q: prefix })).items.some(
      (u) => u.id === student,
    ),
  ).toBe(false);
  const data = await studentProgress(student, { viewerId: admin });
  expect(data.user).toMatchObject({
    name: "Удалённый пользователь",
    email: null,
    deleted: true,
  });
  expect(JSON.stringify(data)).not.toContain(original.email);
  expect(JSON.stringify(data)).not.toContain(original.name);
});
it("returns only the current student's attempt history and never sends answer keys for unanswered gaps", async () => {
  await answer(student, false);
  await answer(student, true, true);
  await answer(other, true);
  const history = await gapHistory(f.free.id, student);
  expect(history).toHaveLength(2);
  expect(history.some((a) => a.practice)).toBe(true);
  expect(
    history.every(
      (a) =>
        a.chosen[0].startsWith("неверный") || a.chosen[0].startsWith("верный"),
    ),
  ).toBe(true);
  expect(JSON.stringify(history)).not.toContain("correctValues");
  const lesson = await lessons.loadLesson(f.free.id, { userId: student });
  expect(lesson.gaps[1].feedback).toBeNull();
  expect(JSON.stringify(lesson.gaps[1])).not.toContain("correctOptionIds");
  expect(JSON.stringify(lesson.test)).not.toContain("ОБЪЯСНЕНИЕ");
  await db.topic.update({
    where: { id: f.free.id },
    data: { status: "DRAFT" },
  });
  await expect(gapHistory(f.free.id, student)).rejects.toMatchObject({
    status: 404,
  });
});
it("uses immutable publication snapshots for prior-version gap and quiz answer keys", async () => {
  await recordInitialTopicRevision(db, f.free.id);
  await complete();
  let topic = await content.getTopic(f.free.id);
  const q = topic.questions[0];
  topic = await content.updateTopic(topic.id, topic.editRevision, {
    title: topic.title,
    slug: topic.slug,
    sectionId: topic.sectionId,
    order: topic.order,
    isFree: true,
    contentMd: topic.contentMd.replace(" верный-один|", " новый-эталон|"),
    gapExercises: topic.gapExercises,
    readingMinutes: topic.readingMinutes,
    authorName: topic.authorName,
    reviewerName: topic.reviewerName,
    referencesMd: topic.referencesMd,
    reviewed: true,
  });
  topic = await content.updateQuestion(q.id, topic.editRevision, {
    answerType: q.answerType,
    acceptedAnswers: q.acceptedAnswers,
    stem: q.stem,
    options: q.options,
    correctOptionIds: ["a"],
    explanation: q.explanation,
    sourceBlockKey: q.sourceBlockKey,
    isDiagnostic: q.isDiagnostic,
    order: q.order,
  });
  topic = await content.updateTopic(topic.id, topic.editRevision, {
    title: topic.title,
    slug: topic.slug,
    sectionId: topic.sectionId,
    order: topic.order,
    isFree: true,
    contentMd: topic.contentMd,
    gapExercises: topic.gapExercises,
    readingMinutes: topic.readingMinutes,
    authorName: topic.authorName,
    reviewerName: topic.reviewerName,
    referencesMd: topic.referencesMd,
    reviewed: true,
  });
  topic = await content.setTopicStatus(topic.id, topic.editRevision, "REVIEW");
  await content.publishTopic(topic.id, topic.editRevision);
  const card = await studentProgress(student, { viewerId: admin }),
    lesson = card.topics.find((t) => t.id === f.free.id)!;
  expect(lesson.gaps[0].correct).toEqual(["новый-эталон"]);
  expect(lesson.gaps[0].attempts[0]).toMatchObject({
    version: 1,
    oldVersion: true,
    correct: ["верный-один"],
  });
  expect(lesson.tests[0]).toMatchObject({ version: 1, oldVersion: true });
  expect(lesson.tests[0].answers[0].correct).toEqual(["Вариант Б"]);
});
it("supports search, every sort, pagination and the configured lagging filter in a bounded query", async () => {
  await complete();
  for (const sort of [
    "name",
    "subjects",
    "completed",
    "average",
    "due",
    "overdue",
    "lastActivity",
  ])
    expect(
      (
        await progressSummary({
          viewerId: admin,
          q: prefix,
          sort,
          direction: "desc",
        })
      ).total,
    ).toBe(2);
  expect(
    (
      await progressSummary({
        viewerId: admin,
        q: `${prefix}-1`,
        filter: "lagging",
      })
    ).items,
  ).toHaveLength(0);
  await db.topicProgress.updateMany({
    where: { userId: student },
    data: { lastOpenedAt: new Date(Date.now() - 10 * 86400000) },
  });
  await db.gapAttempt.updateMany({
    where: { userId: student },
    data: { createdAt: new Date(Date.now() - 10 * 86400000) },
  });
  await db.testRun.updateMany({
    where: { userId: student },
    data: { startedAt: new Date(Date.now() - 10 * 86400000) },
  });
  await db.questionAttempt.updateMany({
    where: { testRun: { userId: student } },
    data: { createdAt: new Date(Date.now() - 10 * 86400000) },
  });
  await db.event.updateMany({
    where: { userId: student },
    data: { createdAt: new Date(Date.now() - 10 * 86400000) },
  });
  expect(
    (
      await progressSummary({
        viewerId: admin,
        q: `${prefix}-1`,
        filter: "lagging",
      })
    ).items,
  ).toHaveLength(1);
  const empty = await progressSummary({
    viewerId: admin,
    q: prefix,
    page: 100,
  });
  expect(empty.items).toEqual([]);
  expect(empty.total).toBe(2);
});
it("rejects demo seeding on the normal database or in production without touching any user", async () => {
  const before = await db.user.count();
  await expect(ensureDemoStudents()).rejects.toThrow("preview");
  vi.stubEnv("NODE_ENV", "production");
  await expect(ensureDemoStudents()).rejects.toThrow("preview");
  expect(await db.user.count()).toBe(before);
});

it("limits selected-subject results and aggregates with one summary query regardless of student count", async () => {
  const second = await createLessonFixture("progress-second");
  try {
    await answer();
    const lesson = await lessons.loadLesson(second.free.id, {
      userId: student,
    });
    await lessons.answerGap(
      lesson.gaps[0].id,
      lesson.gaps[0].options[0].id,
      1,
      { userId: student },
    );
    const all = await studentProgress(student, { viewerId: admin });
    expect(new Set(all.topics.map((t) => t.subjectId)).size).toBe(2);
    const scoped = await studentProgress(student, {
      viewerId: admin,
      subjectId: f.subject.id,
    });
    expect(scoped.topics.every((t) => t.subjectId === f.subject.id)).toBe(true);
    expect(scoped.summary.totalTopics).toBe(2);
    expect(all.summary.totalTopics).toBe(4);
    const spy = vi.spyOn(db, "$queryRaw");
    await progressSummary({ viewerId: admin, q: prefix });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockClear();
    await progressSummary({ viewerId: admin });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  } finally {
    await cleanupLessonFixture(second);
  }
});
it("records typed submissions and removes the new journal when a deleted account is anonymized", async () => {
  await addMixedExercises(f);
  const gap = await db.gap.findFirstOrThrow({
    where: { topicId: f.free.id, answerType: "SHORT_TEXT" },
  });
  await lessons.answerGap(gap.id, { text: "ёлка" }, 1, { userId: student });
  await lessons.answerGap(
    gap.id,
    { text: "другой ответ" },
    1,
    { userId: student },
    true,
  );
  expect(
    (
      await db.gapAttempt.findMany({
        where: { userId: student },
        orderBy: { createdAt: "asc" },
      })
    ).map((a) => [a.chosenText, a.isCorrect, a.practice]),
  ).toEqual([
    ["ёлка", true, false],
    ["другой ответ", false, true],
  ]);
  await db.user.update({
    where: { id: student },
    data: { deletedAt: new Date(Date.now() - 40 * 86400000) },
  });
  await anonymizeAccount(student);
  expect(await db.gapAttempt.count({ where: { userId: student } })).toBe(0);
  const card = await studentProgress(student, { viewerId: admin });
  expect(card.user).toMatchObject({
    name: "Удалённый пользователь",
    email: null,
  });
});

it("shows review self-ratings for 30 days and tutor counts without ever reading or returning conversations", async () => {
  await answer();
  const card = await db.card.findFirstOrThrow({ where: { userId: student } }),
    now = new Date();
  await revealCard(student, card.id, card.revision, 1, now);
  await rateCard(student, card.id, card.revision, 1, "HARD", now);
  const conversation = await db.tutorConversation.create({
    data: {
      userId: student,
      subjectId: f.subject.id,
      topicId: f.free.id,
      tutorMessage_conversationId: {
        create: [
          { role: "USER", content: "PRIVATE_CHAT_STUDENT" },
          { role: "ASSISTANT", content: "PRIVATE_CHAT_TUTOR" },
        ],
      },
    },
  });
  expect(conversation.id).toBeTruthy();
  const data = await studentProgress(student, { viewerId: admin });
  expect(data.tutor.total).toBe(1);
  expect(data.topics.find((t) => t.id === f.free.id)!.tutorQuestions).toBe(1);
  expect(data.review.ratings.HARD).toBe(1);
  expect(JSON.stringify(data)).not.toContain("PRIVATE_CHAT");
  await db.reviewLog.updateMany({
    where: { cardId: card.id },
    data: { reviewedAt: new Date(+now - 31 * 86400000) },
  });
  expect(
    (await studentProgress(student, { viewerId: admin })).review.ratings.HARD,
  ).toBe(0);
});
it("handles legacy invalid time zones consistently with SRS instead of breaking the whole summary", async () => {
  await answer();
  await db.user.update({
    where: { id: student },
    data: { timezone: "Unknown/Legacy" },
  });
  expect(
    (await progressSummary({ viewerId: admin, q: `${prefix}-1` })).items,
  ).toHaveLength(1);
});
