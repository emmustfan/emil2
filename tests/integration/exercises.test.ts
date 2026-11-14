import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, afterAll, it, expect, vi } from "vitest";
import { getDb } from "../../lib/db";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import {
  createLessonFixture,
  addMixedExercises,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
import {
  loadLesson,
  answerGap,
  startTest,
  answerQuestion,
} from "../../lib/lessons/service";
import type { Actor } from "../../lib/lessons/types";
import * as content from "../../lib/content/service";
import * as jobs from "../../lib/content/jobs";
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    DEFAULT_SETTINGS[key],
}));
const db = getDb();
let f: LessonFixture;
const demos: string[] = [];
async function actor(): Promise<Actor> {
  const d = await db.demoSession.create({
    data: { anonId: randomUUID(), stepsCompleted: [] },
  });
  demos.push(d.id);
  return { demoSessionId: d.id };
}
beforeEach(async () => {
  f = await createLessonFixture("exercise-test");
  await addMixedExercises(f);
});
afterEach(async () => {
  const queue = await jobs.getContentQueue();
  for (const topicId of [f.free.id, f.paid.id]) {
    const rows = await db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM pgboss.job WHERE name=${jobs.CONTENT_INDEX_QUEUE} AND data->>'topicId'=${topicId}`;
    if (rows.length)
      await queue.deleteJob(
        jobs.CONTENT_INDEX_QUEUE,
        rows.map((r) => r.id),
      );
  }
  await cleanupLessonFixture(f, demos.splice(0));
});
afterAll(async () => {
  await jobs.closeContentQueue();
  await db.$disconnect();
});
it("publishes mixed gap and question configurations and keeps stable gap IDs", async () => {
  let t = await content.getTopic(f.free.id);
  const old = t.gapExercises;
  t = await content.updateTopic(t.id, t.editRevision, {
    title: t.title,
    slug: t.slug,
    sectionId: t.sectionId,
    order: t.order,
    isFree: t.isFree,
    contentMd: t.contentMd,
    readingMinutes: t.readingMinutes,
    authorName: t.authorName,
    reviewerName: t.reviewerName,
    referencesMd: t.referencesMd,
    reviewed: true,
    gapExercises: old,
  });
  t = await content.setTopicStatus(t.id, t.editRevision, "REVIEW");
  const ids = (
    await db.gap.findMany({
      where: { topicId: t.id },
      orderBy: { order: "asc" },
    })
  ).map((g) => g.id);
  t = await content.publishTopic(t.id, t.editRevision);
  expect(t.questions[1].answerType).toBe("MULTIPLE_CHOICE");
  expect(t.questions[2].acceptedAnswers).toEqual(["ёлка", "ель"]);
  const gaps = await db.gap.findMany({
    where: { topicId: t.id },
    orderBy: { order: "asc" },
  });
  expect(gaps.map((g) => g.id)).toEqual(ids);
  expect(gaps.map((g) => g.answerType)).toEqual([
    "SINGLE_CHOICE",
    "MULTIPLE_CHOICE",
    "SHORT_TEXT",
  ]);
});
it("does not send text answers, aliases, explanations or multi correctness before a response", async () => {
  const a = await actor(),
    data = await loadLesson(f.free.id, a),
    wire = JSON.stringify(data);
  expect(data.gaps[2].options).toEqual([]);
  expect(data.test?.questions[2].options).toEqual([]);
  for (const secret of [
    "ёлка",
    '"ель"',
    "correctOptionIds",
    "acceptedAnswers",
    "ОБЪЯСНЕНИЕ_ПРОПУСКА_ПОСЛЕ_ОТВЕТА",
  ])
    expect(wire).not.toContain(secret);
});
it("grades complete multi selections and preserves the first response during practice", async () => {
  const a = await actor(),
    g = (await loadLesson(f.free.id, a)).gaps[1],
    right = g.options.filter((o) => o.text !== "неверный-два").map((o) => o.id);
  const partial = await answerGap(g.id, { optionIds: [right[0]] }, 1, a);
  expect(partial.feedback.correct).toBe(false);
  expect(partial.feedback.correctValues).toHaveLength(2);
  const practice = await answerGap(
    g.id,
    { optionIds: right.reverse() },
    1,
    a,
    true,
  );
  expect(practice.feedback.correct).toBe(true);
  expect((await loadLesson(f.free.id, a)).gaps[1].feedback?.correct).toBe(
    false,
  );
  const other = await actor();
  const full = (await loadLesson(f.free.id, other)).gaps[1];
  expect(
    (
      await answerGap(
        full.id,
        {
          optionIds: full.options
            .filter((o) => o.text !== "неверный-два")
            .map((o) => o.id),
        },
        1,
        other,
      )
    ).feedback.correct,
  ).toBe(true);
});
it("normalizes text and accepts explicit aliases without returning other aliases", async () => {
  const a = await actor(),
    g = (await loadLesson(f.free.id, a)).gaps[2];
  const result = await answerGap(g.id, { text: "  ЕЛКА  " }, 1, a);
  expect(result.feedback.correct).toBe(true);
  expect(result.feedback.chosenValues).toEqual(["ЕЛКА"]);
  expect(JSON.stringify(result)).not.toContain('"ель"');
  expect((await loadLesson(f.free.id, a)).gaps[2].feedback?.correct).toBe(true);
  const other = await actor();
  expect(
    (await answerGap(g.id, { text: "ЕЛЬ" }, 1, other)).feedback.correct,
  ).toBe(true);
});
it("checks all quiz types, restores typed/multi responses and completes the topic", async () => {
  const a = await actor(),
    data = await loadLesson(f.free.id, a);
  for (const g of data.gaps) {
    const input =
      g.answerType === "SHORT_TEXT"
        ? { text: "ель" }
        : g.answerType === "MULTIPLE_CHOICE"
          ? {
              optionIds: g.options
                .filter((o) => o.text !== "неверный-два")
                .map((o) => o.id),
            }
          : {
              optionIds: [g.options.find((o) => o.text === "верный-один")!.id],
            };
    await answerGap(g.id, input, 1, a);
  }
  const run = await startTest(f.free.id, 1, a);
  for (const q of run.questions) {
    const input =
      q.answerType === "SHORT_TEXT"
        ? { text: " еЛкА " }
        : q.answerType === "MULTIPLE_CHOICE"
          ? { optionIds: ["c", "a"] }
          : { optionIds: ["b"] };
    await answerQuestion(f.free.id, run.runId!, q.id, input, a);
  }
  const reload = await loadLesson(f.free.id, a);
  expect(reload.progress).toMatchObject({
    answered: 3,
    correct: 3,
    bestScore: 1,
    completed: true,
  });
  expect(reload.test?.questions[1].feedback?.chosenIds).toEqual(["c", "a"]);
  expect(reload.test?.questions[2].feedback?.chosenText).toBe("еЛкА");
});
it("rejects forged/duplicate/wrong-kind inputs atomically and cannot grade locked topics", async () => {
  const a = await actor(),
    data = await loadLesson(f.free.id, a),
    multi = data.gaps[1],
    text = data.gaps[2];
  for (const input of [
    { optionIds: [multi.options[0].id, multi.options[0].id] },
    { optionIds: ["0".repeat(64)] },
    { text: "text" },
  ])
    await expect(answerGap(multi.id, input, 1, a)).rejects.toMatchObject({
      status: 422,
    });
  await expect(
    answerGap(text.id, { optionIds: ["0".repeat(64)] }, 1, a),
  ).rejects.toMatchObject({ status: 422 });
  expect(await db.gapAnswer.count({ where: { ...a } })).toBe(0);
  const run = await startTest(f.free.id, 1, a);
  await expect(
    answerQuestion(
      f.free.id,
      run.runId!,
      run.questions[2].id,
      { optionIds: ["b"] },
      a,
    ),
  ).rejects.toMatchObject({ status: 422 });
  expect(
    await db.questionAttempt.count({ where: { testRunId: run.runId! } }),
  ).toBe(0);
  await expect(
    answerGap(f.paid.gap_topicId[0].id, { text: "anything" }, 1, a),
  ).rejects.toMatchObject({ status: 403 });
});
it("keeps saved feedback snapshots when the author changes the active answer configuration", async () => {
  const a = await actor(),
    g = (await loadLesson(f.free.id, a)).gaps[1];
  const result = await answerGap(
    g.id,
    {
      optionIds: g.options
        .filter((o) => o.text !== "неверный-два")
        .map((o) => o.id),
    },
    1,
    a,
  );
  await db.gap.update({
    where: { id: g.id },
    data: {
      answerType: "SINGLE_CHOICE",
      correctAnswers: ["верный-два"],
      explanation: "Новое объяснение",
    },
  });
  const saved = (await loadLesson(f.free.id, a)).gaps[1].feedback;
  expect(saved).toEqual(result.feedback);
  expect(saved?.correctValues).toHaveLength(2);
});
