import { prepareTurn, executeTurn } from "../../lib/tutor/service";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "../../lib/db";
import { newToken, hashToken } from "../../lib/auth/crypto";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import { demoAction, demoView } from "../../lib/demo/service";
import { transferGuest } from "../../lib/demo/transfer";
import { guestDemo } from "../../lib/lessons/actor";
import { loadLesson, answerGap } from "../../lib/lessons/service";
import { readFlow } from "../../lib/demo/flow";
import { createDemoFixture } from "../helpers/demo-fixture";
import { cleanupLessonFixture } from "../helpers/lesson-fixture";
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    DEFAULT_SETTINGS[key],
}));
const db = getDb();
let f: Awaited<ReturnType<typeof createDemoFixture>>;
const demos: string[] = [],
  users: string[] = [];
async function guest() {
  const token = newToken(),
    demo = await guestDemo(token);
  demos.push(demo.id);
  return { token, id: demo.id, actor: { demoSessionId: demo.id } };
}
async function user() {
  const u = await db.user.create({
    data: { name: "Ученик демо", consentPdAt: new Date() },
  });
  users.push(u.id);
  return u;
}
beforeAll(async () => {
  f = await createDemoFixture("demo-integration");
});
afterAll(async () => {
  if (f) await cleanupLessonFixture(f, demos, users);
  await db.$disconnect();
});
describe("demo workflow and atomic guest transfer", () => {
  it("pins three distinct topics, grades all answers and emits conversion events once", async () => {
    const g = await guest();
    await expect(demoAction(g.id, { action: "finish" })).rejects.toThrow();
    await demoView(g.id, "landing");
    await demoView(g.id);
    await demoAction(g.id, { action: "goal", goal: "session" });
    const step = await demoAction(g.id, {
      action: "subject",
      subjectId: f.subject.id,
    });
    expect(step.step).toBe(3);
    const row = await db.demoSession.findUniqueOrThrow({ where: { id: g.id } }),
      flow = readFlow(row.flow);
    expect(new Set(flow.questions.map((q) => q.topicId)).size).toBe(3);
    for (const pinned of flow.questions) {
      const view = await demoView(g.id);
      expect(view.question?.id).toBe(pinned.id);
      expect(JSON.stringify(view)).not.toMatch(
        /correctOptionIds|СЕКРЕТ|ОБЪЯСНЕНИЕ_ПОСЛЕ/,
      );
      await demoAction(g.id, {
        action: "answer",
        questionId: pinned.id,
        submission: { optionIds: ["b"] },
      });
    }
    const result = await demoView(g.id);
    expect(result).toMatchObject({ step: 4, correct: 3 });
    expect(result.strong).toHaveLength(3);
    expect(
      await db.event.count({
        where: { anonId: hashToken(g.token), name: "demo_started" },
      }),
    ).toBe(1);
    await demoAction(g.id, { action: "lesson" });
    const lesson = await loadLesson(f.free.id, g.actor),
      gap = lesson.gaps[0];
    await answerGap(gap.id, gap.options[0].id, lesson.version, g.actor);
    const review = await demoAction(g.id, { action: "review" });
    expect(review.cardCount).toBe(1);
    expect(review.card?.answer).toBeNull();
    await expect(
      demoAction(g.id, {
        action: "rate",
        cardId: review.card!.id,
        rating: "GOOD",
      }),
    ).rejects.toThrow();
    await expect(
      demoAction(g.id, { action: "reveal", cardId: "foreign" }),
    ).rejects.toThrow();
    const revealed = await demoAction(g.id, {
      action: "reveal",
      cardId: review.card!.id,
    });
    expect(revealed.card?.answer).toBeTruthy();
    await Promise.all([
      demoAction(g.id, {
        action: "rate",
        cardId: review.card!.id,
        rating: "GOOD",
      }),
      demoAction(g.id, {
        action: "rate",
        cardId: review.card!.id,
        rating: "GOOD",
      }),
    ]);
    expect(
      await db.reviewLog.count({ where: { cardId: review.card!.id } }),
    ).toBe(1);
    await demoAction(g.id, { action: "finish" });
    await demoAction(g.id, { action: "finish" });
    expect(
      await db.event.count({
        where: { anonId: hashToken(g.token), name: "demo_completed" },
      }),
    ).toBe(1);
    const names = (
      await db.event.findMany({
        where: { anonId: hashToken(g.token) },
        select: { name: true },
      })
    ).map((e) => e.name);
    for (const required of [
      "demo_started",
      "demo_goal_selected",
      "demo_subject_selected",
      "diagnostic_completed",
      "demo_lesson_opened",
      "demo_completed",
    ])
      expect(names).toContain(required);
    const u = await user();
    await transferGuest(u.id, {
      demoToken: g.token,
      anonToken: g.token,
      touch: '{"utm_source":"search"}',
      signup: true,
    });
    expect(await db.gapAnswer.count({ where: { userId: u.id } })).toBe(1);
    expect(
      await db.testRun.count({ where: { userId: u.id, mode: "DIAGNOSTIC" } }),
    ).toBe(1);
    expect(await db.card.count({ where: { userId: u.id } })).toBe(1);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: u.id } })).diagnostic,
    ).toMatchObject({ correct: 3 });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: u.id } })).utm,
    ).toEqual({ utm_source: "search" });
    await expect(
      answerGap(gap.id, gap.options[0].id, lesson.version, g.actor),
    ).rejects.toThrow();
    expect(
      (await transferGuest(u.id, { demoToken: g.token })).transferred,
    ).toBe(false);
  });
  it("skips diagnosis, permits an empty review and never invents cards", async () => {
    const g = await guest();
    await demoAction(g.id, { action: "goal", goal: "skip" });
    expect(
      (await demoAction(g.id, { action: "subject", subjectId: f.subject.id }))
        .step,
    ).toBe(5);
    const review = await demoAction(g.id, { action: "review" });
    expect(review.cardCount).toBe(0);
    expect((await demoAction(g.id, { action: "finish" })).step).toBe(7);
    expect(await db.testRun.count({ where: { demoSessionId: g.id } })).toBe(0);
  });
  it("keeps existing first answers and schedules when concurrent claims conflict", async () => {
    const g = await guest(),
      u = await user(),
      other = await user();
    const userActor = { userId: u.id },
      gl = await loadLesson(f.free.id, g.actor),
      ul = await loadLesson(f.free.id, userActor);
    await answerGap(
      gl.gaps[0].id,
      gl.gaps[0].options[0].id,
      gl.version,
      g.actor,
    );
    const chosen = ul.gaps[0].options[1].id;
    await answerGap(ul.gaps[0].id, chosen, ul.version, userActor);
    const before = await db.card.findFirstOrThrow({
      where: { userId: u.id, gapId: gl.gaps[0].id },
    });
    await Promise.all([
      transferGuest(u.id, { demoToken: g.token }),
      transferGuest(u.id, { demoToken: g.token }),
    ]);
    const answer = await db.gapAnswer.findUniqueOrThrow({
      where: { userId_gapId: { userId: u.id, gapId: gl.gaps[0].id } },
    });
    expect(answer.chosen).toBe(ul.gaps[0].options[1].text);
    const after = await db.card.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.dueAt).toEqual(before.dueAt);
    expect(
      (await transferGuest(other.id, { demoToken: g.token })).transferred,
    ).toBe(false);
    expect(await db.card.count({ where: { demoSessionId: g.id } })).toBe(0);
  });
  it("rolls the whole transfer back on failure, including source ownership", async () => {
    const g = await guest(),
      u = await user(),
      l = await loadLesson(f.free.id, g.actor);
    await answerGap(l.gaps[0].id, l.gaps[0].options[0].id, l.version, g.actor);
    await expect(
      db.$transaction(async (tx) => {
        await transferGuest(u.id, { demoToken: g.token }, tx);
        throw new Error("rollback fixture");
      }),
    ).rejects.toThrow("rollback fixture");
    expect(
      (await db.demoSession.findUniqueOrThrow({ where: { id: g.id } })).userId,
    ).toBeNull();
    expect(await db.gapAnswer.count({ where: { demoSessionId: g.id } })).toBe(
      1,
    );
  });
  it("rejects answers if a pinned topic version changed", async () => {
    const g = await guest();
    await demoAction(g.id, { action: "goal", goal: "gia" });
    const view = await demoAction(g.id, {
      action: "subject",
      subjectId: f.subject.id,
    });
    const pinned = readFlow(
      (await db.demoSession.findUniqueOrThrow({ where: { id: g.id } })).flow,
    ).questions[0];
    await db.topic.update({
      where: { id: pinned.topicId },
      data: { version: { increment: 1 } },
    });
    await expect(
      demoAction(g.id, {
        action: "answer",
        questionId: view.question!.id,
        submission: { optionIds: ["b"] },
      }),
    ).rejects.toThrow(/обновлена/);
    await db.topic.update({
      where: { id: pinned.topicId },
      data: { version: { decrement: 1 } },
    });
  });
  it("moves tutor history, cancels an in-flight guest turn and refunds only its old quota", async () => {
    const g = await guest(),
      u = await user();
    const prepared = await prepareTurn(
      {
        kind: "question",
        text: "Как работать с материалом?",
        topicId: f.free.id,
        requestId: randomUUID(),
      },
      g.actor,
    );
    const old = await db.tutorMessage.create({
      data: {
        conversationId: prepared.conversationId,
        role: "USER",
        content: "Ранее заданный вопрос",
        requestKey: `demo:${g.id}:${randomUUID()}`,
      },
    });
    await db.tutorMessage.create({
      data: {
        conversationId: prepared.conversationId,
        role: "ASSISTANT",
        content: "Ранее сохранённый ответ",
        replyToId: old.id,
        citations: [],
      },
    });
    await transferGuest(u.id, { demoToken: g.token });
    expect(
      await db.tutorConversation.findUniqueOrThrow({
        where: { id: prepared.conversationId },
      }),
    ).toMatchObject({ userId: u.id, demoSessionId: null });
    expect(
      await db.tutorMessage.findUniqueOrThrow({
        where: { id: prepared.messageId },
      }),
    ).toMatchObject({ status: "FAILED", runToken: null });
    expect(
      (
        await db.usageCounter.findUniqueOrThrow({
          where: {
            actorKey_feature_periodStart: {
              actorKey: `demo:${g.id}`,
              feature: "tutor",
              periodStart: new Date(0),
            },
          },
        })
      ).count,
    ).toBe(0);
    expect(
      await db.tutorMessage.count({
        where: { conversationId: prepared.conversationId, status: "COMPLETED" },
      }),
    ).toBe(2);
    await expect(executeTurn(prepared, () => {})).rejects.toThrow();
    expect(
      await db.usageCounter.count({
        where: { actorKey: `user:${u.id}`, feature: "tutor" },
      }),
    ).toBe(0);
  });
  it("preserves the best topic score and migrates all finished attempts", async () => {
    const g = await guest(),
      u = await user();
    await db.testRun.create({
      data: {
        ...g.actor,
        topicId: f.free.id,
        subjectId: f.subject.id,
        mode: "TOPIC",
        topicVersion: 1,
        total: 5,
        correct: 2,
        score: 0.4,
        finishedAt: new Date(),
      },
    });
    await db.testRun.create({
      data: {
        userId: u.id,
        topicId: f.free.id,
        subjectId: f.subject.id,
        mode: "TOPIC",
        topicVersion: 1,
        total: 5,
        correct: 5,
        score: 1,
        finishedAt: new Date(),
      },
    });
    await transferGuest(u.id, { demoToken: g.token });
    const progress = await db.topicProgress.findUniqueOrThrow({
      where: { userId_topicId: { userId: u.id, topicId: f.free.id } },
    });
    expect(progress.testBestScore).toBe(1);
    expect(
      await db.testRun.count({ where: { userId: u.id, topicId: f.free.id } }),
    ).toBe(2);
  });
  it("rejects invalid choices without recording or revealing an answer", async () => {
    const g = await guest();
    await demoAction(g.id, { action: "goal", goal: "session" });
    const view = await demoAction(g.id, {
      action: "subject",
      subjectId: f.subject.id,
    });
    await expect(
      demoAction(g.id, {
        action: "answer",
        questionId: view.question!.id,
        submission: { optionIds: ["forged"] },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect((await demoView(g.id)).answered).toBe(0);
  });
});
