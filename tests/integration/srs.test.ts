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
  answerGap,
  answerQuestion,
  loadLesson,
  startTest,
} from "../../lib/lessons/service";
import {
  getReviewQueue,
  getReviewSummary,
  revealCard,
  rateCard,
} from "../../lib/srs/service";
const config = vi.hoisted(() => ({ cap: 30 }));
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    key === "srs.newCardsPerDay" ? config.cap : DEFAULT_SETTINGS[key],
}));
const db = getDb();
let f: LessonFixture, userId: string;
const users: string[] = [],
  demos: string[] = [];
async function user() {
  const u = await db.user.create({
    data: {
      email: `srs-${randomUUID()}@example.test`,
      timezone: "Asia/Yekaterinburg",
    },
  });
  users.push(u.id);
  return u.id;
}
beforeEach(async () => {
  config.cap = 30;
  f = await createLessonFixture("srs-test");
  await addMixedExercises(f);
  userId = await user();
});
afterEach(async () => {
  await cleanupLessonFixture(f, demos.splice(0), users.splice(0));
});
afterAll(async () => {
  await db.$disconnect();
});
async function gapCard(index = 0, correct = false, owner = userId) {
  const g = (await loadLesson(f.free.id, { userId: owner })).gaps[index];
  const submission =
    g.answerType === "SHORT_TEXT"
      ? { text: correct ? "ель" : "куст" }
      : {
          optionIds: g.options
            .filter((o) =>
              correct
                ? !o.text.startsWith("неверный")
                : o.text.startsWith("неверный"),
            )
            .map((o) => o.id),
        };
  await answerGap(g.id, submission, 1, { userId: owner });
  return await db.card.findUniqueOrThrow({
    where: { userId_gapId: { userId: owner, gapId: g.id } },
  });
}
it("creates one card per first gap answer, due now for mistakes and tomorrow for correct answers", async () => {
  const before = Date.now(),
    wrong = await gapCard(),
    correct = await gapCard(1, true);
  expect(wrong.dueAt.getTime()).toBeGreaterThanOrEqual(before);
  expect(correct.dueAt.getTime()).toBeGreaterThanOrEqual(before + 86400000);
  const g = (await loadLesson(f.free.id, { userId })).gaps[0];
  await answerGap(
    g.id,
    { optionIds: [g.options.find((o) => o.text === "верный-один")!.id] },
    1,
    { userId },
  );
  await answerGap(
    g.id,
    { optionIds: [g.options.find((o) => o.text === "верный-один")!.id] },
    1,
    { userId },
    true,
  );
  expect(await db.card.count({ where: { userId } })).toBe(2);
  expect(await db.card.findUnique({ where: { id: wrong.id } })).toMatchObject({
    dueAt: wrong.dueAt,
    revision: 0,
  });
  expect((await getReviewQueue(userId)).cards.map((c) => c.id)).toEqual([
    wrong.id,
  ]);
  const d = await db.demoSession.create({
    data: { anonId: randomUUID(), stepsCompleted: [] },
  });
  demos.push(d.id);
  const guest = { demoSessionId: d.id },
    guestGap = (await loadLesson(f.free.id, guest)).gaps[0];
  await answerGap(guestGap.id, guestGap.options[0].id, 1, guest);
  expect(
    await db.card.count({ where: { demoSessionId: d.id, userId: null } }),
  ).toBe(1);
  expect((await getReviewQueue(userId)).cards).toHaveLength(1);
});
it("keeps canonical answers and explanations off the front and reveals all exercise types", async () => {
  const multi = await gapCard(1),
    text = await gapCard(2),
    run = await startTest(f.free.id, 1, { userId });
  for (const q of run.questions.slice(1, 3))
    await answerQuestion(
      f.free.id,
      run.runId!,
      q.id,
      q.answerType === "SHORT_TEXT" ? { text: "куст" } : { optionIds: ["b"] },
      { userId },
    );
  const queue = await getReviewQueue(userId),
    wire = JSON.stringify(queue);
  for (const secret of [
    "верный-два",
    "дополнительный-верный",
    "ёлка",
    '"ель"',
    "Вариант А",
    "ОБЪЯСНЕНИЕ",
    "acceptedAnswers",
    "correctOptionIds",
  ])
    expect(wire).not.toContain(secret);
  expect(queue.cards).toHaveLength(4);
  const back = await revealCard(userId, multi.id, 0, 1);
  expect(back.answers).toEqual(["верный-два", "дополнительный-верный"]);
  expect(back.context).toContain("верный-два; дополнительный-верный");
  expect(back.explanation).toBe("ОБЪЯСНЕНИЕ_ПРОПУСКА_ПОСЛЕ_ОТВЕТА");
  expect(await revealCard(userId, text.id, 0, 1)).toMatchObject({
    answers: ["ёлка"],
    alternatives: ["ель"],
  });
  for (const c of queue.cards.filter((c) => c.source === "QUESTION")) {
    const b = await revealCard(userId, c.id, 0, 1);
    expect(b.answers).toEqual(
      c.prompt.startsWith("Вопрос 2") ? ["Вариант А", "Вариант В"] : ["ёлка"],
    );
    expect(b.explanation).toContain("ОБЪЯСНЕНИЕ_ПОСЛЕ_ОТВЕТА");
  }
});
it("requires reveal, applies simultaneous retries once and returns HARD exactly ten minutes later", async () => {
  // Keep both reviews in one known local day regardless of the test runner clock.
  const c = await gapCard(),
    now = new Date("2026-11-07T10:00:00Z");
  await db.card.update({ where: { id: c.id }, data: { dueAt: now } });
  await expect(rateCard(userId, c.id, 0, 1, "HARD", now)).rejects.toMatchObject(
    { status: 409 },
  );
  await revealCard(userId, c.id, 0, 1, now);
  const replies = await Promise.all([
    rateCard(userId, c.id, 0, 1, "HARD", now),
    rateCard(userId, c.id, 0, 1, "HARD", now),
  ]);
  expect(replies.filter((r) => r.duplicate)).toHaveLength(1);
  expect(await db.reviewLog.count({ where: { cardId: c.id } })).toBe(1);
  expect(await db.card.findUnique({ where: { id: c.id } })).toMatchObject({
    state: "LEARNING",
    reps: 1,
    lapses: 0,
    ease: 2.3,
    intervalDays: 0,
    revision: 1,
    dueAt: new Date(now.getTime() + 600000),
  });
  expect(
    (await getReviewQueue(userId, new Date(now.getTime() + 599999))).cards,
  ).toHaveLength(0);
  expect(
    (await getReviewQueue(userId, new Date(now.getTime() + 600000))).cards.map(
      (c) => c.id,
    ),
  ).toEqual([c.id]);
  await expect(rateCard(userId, c.id, 0, 1, "EASY", now)).rejects.toMatchObject(
    { status: 409 },
  );
  const later = new Date(now.getTime() + 600000);
  await revealCard(userId, c.id, 1, 1, later);
  await rateCard(userId, c.id, 1, 1, "GOOD", later);
  expect(await getReviewSummary(userId, later)).toMatchObject({
    dueCount: 0,
    reviewedToday: 2,
    nextDueAt: new Date(later.getTime() + 86400000).toISOString(),
  });
});
it("serializes daily introductions across tabs and releases the quota at the user's local midnight", async () => {
  config.cap = 1;
  const a = await gapCard(),
    b = await gapCard(1),
    now = new Date("2030-11-07T18:59:00Z");
  expect((await getReviewQueue(userId, now)).cards).toHaveLength(1);
  const results = await Promise.allSettled([
    revealCard(userId, a.id, 0, 1, now),
    revealCard(userId, b.id, 0, 1, now),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { status: 409 },
  });
  const shown = await db.card.findFirstOrThrow({
    where: { userId, firstShownAt: { not: null } },
  });
  expect(await getReviewSummary(userId, now)).toMatchObject({
    dueCount: 1,
    newShownToday: 1,
    newWaiting: 1,
  });
  await rateCard(userId, shown.id, 0, 1, "GOOD", now);
  expect(await getReviewSummary(userId, now)).toMatchObject({
    dueCount: 0,
    nextDueAt: "2030-11-07T19:00:00.000Z",
  });
  const midnight = new Date("2030-11-07T19:00:00Z");
  expect(await getReviewSummary(userId, midnight)).toMatchObject({
    dueCount: 1,
    newShownToday: 0,
    reviewedToday: 0,
  });
  const waiting = (await getReviewQueue(userId, midnight)).cards[0];
  await revealCard(userId, waiting.id, 0, 1, midnight);
  // Already introduced reviews remain available after the new-card limit.
  await db.card.update({ where: { id: shown.id }, data: { dueAt: midnight } });
  expect((await getReviewQueue(userId, midnight)).cards).toHaveLength(2);
});
it("rejects other owners, stale versions and unpublished, suspended, archived or blocked sources", async () => {
  const c = await gapCard(),
    other = await user();
  await expect(revealCard(other, c.id, 0, 1)).rejects.toMatchObject({
    status: 404,
  });
  expect((await getReviewQueue(other)).cards).toHaveLength(0);
  await revealCard(userId, c.id, 0, 1);
  await db.topic.update({ where: { id: f.free.id }, data: { version: 2 } });
  await expect(rateCard(userId, c.id, 0, 1, "GOOD")).rejects.toMatchObject({
    status: 409,
  });
  await expect(rateCard(userId, c.id, 0, 2, "GOOD")).rejects.toMatchObject({
    status: 409,
  });
  await revealCard(userId, c.id, 0, 2);
  for (const mode of ["draft", "suspended", "archived"] as const) {
    if (mode === "draft")
      await db.topic.update({
        where: { id: f.free.id },
        data: { status: "DRAFT" },
      });
    if (mode === "suspended")
      await db.card.update({ where: { id: c.id }, data: { suspended: true } });
    if (mode === "archived")
      await db.gap.update({
        where: { id: c.gapId! },
        data: { archivedAt: new Date() },
      });
    expect((await getReviewQueue(userId)).cards).toHaveLength(0);
    await expect(revealCard(userId, c.id, 0, 2)).rejects.toMatchObject({
      status: 409,
    });
    await db.topic.update({
      where: { id: f.free.id },
      data: { status: "PUBLISHED" },
    });
    await db.card.update({ where: { id: c.id }, data: { suspended: false } });
    await db.gap.update({
      where: { id: c.gapId! },
      data: { archivedAt: null },
    });
  }
  await db.user.update({
    where: { id: userId },
    data: { blockedAt: new Date() },
  });
  await expect(getReviewQueue(userId)).rejects.toMatchObject({ status: 401 });
  await expect(rateCard(userId, c.id, 0, 2, "GOOD")).rejects.toMatchObject({
    status: 401,
  });
});
it("retains paid cards but hides their content when a subject grant expires", async () => {
  const grant = await db.accessGrant.create({
    data: {
      userId,
      subjectId: f.subject.id,
      expiresAt: new Date(Date.now() + 86400000),
      grantedById: userId,
      reason: "Синтетическая проверка",
    },
  });
  const g = (await loadLesson(f.paid.id, { userId })).gaps[0];
  await answerGap(
    g.id,
    g.options.find((o) => o.text === "неверный-один")!.id,
    1,
    { userId },
  );
  const c = (await getReviewQueue(userId)).cards[0];
  await revealCard(userId, c.id, 0, 1);
  await db.accessGrant.update({
    where: { id: grant.id },
    data: { expiresAt: new Date(0) },
  });
  expect((await getReviewQueue(userId)).cards).toHaveLength(0);
  await expect(revealCard(userId, c.id, 0, 1)).rejects.toMatchObject({
    status: 403,
  });
  await expect(rateCard(userId, c.id, 0, 1, "GOOD")).rejects.toMatchObject({
    status: 403,
  });
  expect(await db.card.count({ where: { id: c.id } })).toBe(1);
});
it("a new quiz mistake brings back a learned card without resetting history; old requests cannot reschedule it", async () => {
  const actor = { userId },
    run = await startTest(f.free.id, 1, actor),
    q = run.questions[0];
  await answerQuestion(f.free.id, run.runId!, q.id, "a", actor);
  const c = (await getReviewQueue(userId)).cards[0];
  await revealCard(userId, c.id, 0, 1);
  await rateCard(userId, c.id, 0, 1, "EASY");
  const learned = await db.card.findUniqueOrThrow({ where: { id: c.id } });
  await answerQuestion(f.free.id, run.runId!, q.id, "a", actor);
  expect(await db.card.findUnique({ where: { id: c.id } })).toMatchObject({
    dueAt: learned.dueAt,
    revision: 1,
  });
  for (const other of run.questions.slice(1))
    await answerQuestion(
      f.free.id,
      run.runId!,
      other.id,
      other.answerType === "SHORT_TEXT"
        ? { text: "ель" }
        : {
            optionIds:
              other.answerType === "MULTIPLE_CHOICE" ? ["a", "c"] : ["b"],
          },
      actor,
    );
  const next = await startTest(f.free.id, 1, actor);
  await answerQuestion(f.free.id, next.runId!, q.id, "a", actor);
  expect(await db.card.findUnique({ where: { id: c.id } })).toMatchObject({
    revision: 2,
    reps: 1,
    ease: learned.ease,
    intervalDays: 3,
  });
  expect((await getReviewQueue(userId)).cards.map((c) => c.id)).toEqual([c.id]);
  expect(await db.reviewLog.count({ where: { cardId: c.id } })).toBe(1);
});
