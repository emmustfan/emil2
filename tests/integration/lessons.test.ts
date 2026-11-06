import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { getDb } from "../../lib/db";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
import {
  loadLesson,
  answerGap,
  startTest,
  answerQuestion,
} from "../../lib/lessons/service";
import { consumeLimit } from "../../lib/access";
import type { Actor } from "../../lib/lessons/types";
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    DEFAULT_SETTINGS[key],
}));
const db = getDb();
let fixture: LessonFixture;
const demos: string[] = [],
  users: string[] = [];
async function guest(): Promise<Actor> {
  const row = await db.demoSession.create({
    data: { anonId: randomUUID(), stepsCompleted: [] },
  });
  demos.push(row.id);
  return { demoSessionId: row.id };
}
async function user(): Promise<Actor> {
  const row = await db.user.create({ data: { name: "Студент фикстуры" } });
  users.push(row.id);
  return { userId: row.id };
}
beforeAll(async () => {
  fixture = await createLessonFixture("lesson-integration");
});
afterAll(async () => {
  if (fixture) await cleanupLessonFixture(fixture, demos, users);
  await db.$disconnect();
});
describe("lesson persistence and access with PostgreSQL", () => {
  it("only serializes shuffled options and hides feedback before an answer", async () => {
    const actor = await guest(),
      lesson = await loadLesson(fixture.free.id, actor);
    expect(lesson.locked).toBe(false);
    expect(lesson.gaps.every((g) => g.feedback === null)).toBe(true);
    const wire = JSON.stringify(lesson);
    for (const forbidden of [
      "correctOptionIds",
      "ОБЪЯСНЕНИЕ_ПОСЛЕ_ОТВЕТА",
      "[[",
      "gapKey",
      "distractors",
    ])
      expect(wire).not.toContain(forbidden);
    expect(lesson.gaps).toHaveLength(2);
    expect(lesson.test?.questions).toHaveLength(5);
    expect((await loadLesson(fixture.free.id, actor)).gaps).toEqual(
      lesson.gaps,
    );
  });
  it("stores exactly one first answer under concurrent submissions and preserves it during practice", async () => {
    const actor = await guest(),
      lesson = await loadLesson(fixture.free.id, actor),
      gap = lesson.gaps[0];
    const wrong = gap.options.find((o) => o.text.startsWith("неверный"))!,
      right = gap.options.find((o) => o.text.startsWith("верный"))!;
    const responses = await Promise.all([
      answerGap(gap.id, wrong.id, 1, actor),
      answerGap(gap.id, right.id, 1, actor),
    ]);
    expect(responses[0].feedback).toEqual(responses[1].feedback);
    expect(
      await db.gapAnswer.count({ where: { ...actor, gapId: gap.id } }),
    ).toBe(1);
    const saved = await db.gapAnswer.findFirstOrThrow({
      where: { ...actor, gapId: gap.id },
    });
    const practice = await answerGap(
      gap.id,
      saved.isCorrect ? wrong.id : right.id,
      1,
      actor,
      true,
    );
    expect(practice.feedback.correct).toBe(!saved.isCorrect);
    const reload = await loadLesson(fixture.free.id, actor);
    expect(reload.gaps[0].feedback?.chosen).toBe(saved.chosen);
    expect(reload.progress?.answered).toBe(1);
  });
  it("completes a free guest lesson, restores partial tests, and keeps the best score on a retake", async () => {
    const actor = await guest();
    let lesson = await loadLesson(fixture.free.id, actor);
    for (const gap of lesson.gaps)
      await answerGap(
        gap.id,
        gap.options.find((o) => o.text.startsWith("верный"))!.id,
        1,
        actor,
      );
    let test = await startTest(fixture.free.id, 1, actor);
    expect((await startTest(fixture.free.id, 1, actor)).runId).toBe(test.runId);
    await answerQuestion(
      fixture.free.id,
      test.runId!,
      test.questions[0].id,
      "b",
      actor,
    );
    lesson = await loadLesson(fixture.free.id, actor);
    expect(lesson.test?.questions[0].feedback?.correct).toBe(true);
    expect(lesson.test?.questions[1].feedback).toBeNull();
    for (const q of test.questions.slice(1))
      await answerQuestion(fixture.free.id, test.runId!, q.id, "b", actor);
    lesson = await loadLesson(fixture.free.id, actor);
    expect(lesson.progress).toMatchObject({
      answered: 2,
      correct: 2,
      bestScore: 1,
      completed: true,
    });
    expect(lesson.test).toMatchObject({ finished: true, score: 1 });
    const oldRun = test.runId;
    test = await startTest(fixture.free.id, 1, actor);
    expect(test.runId).not.toBe(oldRun);
    for (const q of test.questions)
      await answerQuestion(fixture.free.id, test.runId!, q.id, "a", actor);
    lesson = await loadLesson(fixture.free.id, actor);
    expect(lesson.test?.score).toBe(0);
    expect(lesson.progress?.bestScore).toBe(1);
    expect(lesson.progress?.completed).toBe(true);
  });
  it("makes quiz answers idempotent under a race and rejects another actor's run", async () => {
    const actor = await guest(),
      other = await guest(),
      test = await startTest(fixture.free.id, 1, actor),
      q = test.questions[0];
    await Promise.all([
      answerQuestion(fixture.free.id, test.runId!, q.id, "a", actor),
      answerQuestion(fixture.free.id, test.runId!, q.id, "b", actor),
    ]);
    expect(
      await db.questionAttempt.count({
        where: { testRunId: test.runId!, questionId: q.id },
      }),
    ).toBe(1);
    await expect(
      answerQuestion(fixture.free.id, test.runId!, q.id, "b", other),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("does not serialize closed blocks, gap options or quiz data and rejects direct submissions", async () => {
    const actor = await guest(),
      lesson = await loadLesson(fixture.paid.id, actor);
    expect(lesson.locked).toBe(true);
    expect(lesson.blocks).toHaveLength(2);
    expect(lesson.gaps).toEqual([]);
    expect(lesson.test).toBeNull();
    const wire = JSON.stringify(lesson);
    for (const text of [
      "ПЛАТНЫЙ_СЕКРЕТ",
      "верный-один",
      "неверный-один",
      "ОБЪЯСНЕНИЕ",
    ])
      expect(wire).not.toContain(text);
    await expect(
      answerGap(fixture.paid.gap_topicId[0].id, "0".repeat(64), 1, actor),
    ).rejects.toMatchObject({ status: 403 });
    await expect(startTest(fixture.paid.id, 1, actor)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      answerQuestion(
        fixture.paid.id,
        "forged",
        fixture.paid.question_topicId[0].id,
        "b",
        actor,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.gapAnswer.count({ where: { ...actor } })).toBe(0);
  });
  it("opens paid content with a live grant, revokes it immediately and persists signed-in TopicProgress", async () => {
    const actor = await user();
    const grant = await db.accessGrant.create({
      data: {
        userId: actor.userId!,
        grantedById: actor.userId!,
        subjectId: fixture.subject.id,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const lesson = await loadLesson(fixture.paid.id, actor);
    expect(lesson.locked).toBe(false);
    const gap = lesson.gaps[0];
    await answerGap(gap.id, gap.options[0].id, 1, actor);
    expect(
      await db.topicProgress.findUnique({
        where: {
          userId_topicId: { userId: actor.userId!, topicId: fixture.paid.id },
        },
      }),
    ).toMatchObject({ gapsAnswered: 1 });
    await db.accessGrant.update({
      where: { id: grant.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect((await loadLesson(fixture.paid.id, actor)).locked).toBe(true);
    await expect(
      answerGap(gap.id, gap.options[0].id, 1, actor),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects forged options, unpublished content and stale lesson/test versions", async () => {
    const actor = await guest(),
      lesson = await loadLesson(fixture.free.id, actor),
      gap = lesson.gaps[0],
      test = await startTest(fixture.free.id, 1, actor);
    await expect(
      answerGap(gap.id, "0".repeat(64), 1, actor),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      answerGap(gap.id, gap.options[0].id, 2, actor),
    ).rejects.toMatchObject({ status: 409 });
    await db.topic.update({
      where: { id: fixture.free.id },
      data: { status: "DRAFT" },
    });
    await expect(loadLesson(fixture.free.id, actor)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      answerGap(gap.id, gap.options[0].id, 1, actor),
    ).rejects.toMatchObject({ status: 404 });
    await db.topic.update({
      where: { id: fixture.free.id },
      data: { status: "PUBLISHED", version: 2 },
    });
    await expect(
      answerQuestion(
        fixture.free.id,
        test.runId!,
        test.questions[0].id,
        "b",
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await db.topic.update({
      where: { id: fixture.free.id },
      data: { version: 1 },
    });
  });
  it("enforces an atomic request limit without increasing it past the cap", async () => {
    const actor = await guest(),
      actorKey = `demo:${actor.demoSessionId}`,
      periodStart = new Date(Math.floor(Date.now() / 60000) * 60000);
    await db.usageCounter.create({
      data: {
        actorKey,
        feature: "lesson",
        periodStart,
        count: DEFAULT_SETTINGS["lesson.requestsPerMinute"] - 1,
      },
    });
    const responses = await Promise.allSettled([
      consumeLimit(actorKey),
      consumeLimit(actorKey),
    ]);
    expect(responses.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(responses.find((r) => r.status === "rejected")).toMatchObject({
      reason: { status: 429 },
    });
  });
});
