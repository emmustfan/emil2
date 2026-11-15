import { beforeEach, afterEach, afterAll, expect, it, vi } from "vitest";
import { newToken } from "../../lib/auth/crypto";
import { getDb } from "../../lib/db";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import * as locks from "../../lib/content/locks";
import * as content from "../../lib/content/service";
import * as lessons from "../../lib/lessons/service";
import { lockLearningActor, guestDemo } from "../../lib/lessons/actor";
import { revealCard, rateCard } from "../../lib/srs/service";
import { resolveScope } from "../../lib/tutor/scope";
import { demoAction, demoView } from "../../lib/demo/service";
import { readFlow } from "../../lib/demo/flow";
import { transferGuest } from "../../lib/demo/transfer";
import { parseTopic } from "../../lib/content/parse";
import { shuffledOptions } from "../../lib/lessons/public";
import type { TopicDTO } from "../../lib/content/types";
import type { TopicInput } from "../../lib/content/validation";
import { createDemoFixture } from "../helpers/demo-fixture";
import {
  cleanupLessonFixture,
  addMixedExercises,
} from "../helpers/lesson-fixture";

vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    DEFAULT_SETTINGS[key],
}));
vi.mock("../../lib/content/jobs", () => ({
  getContentQueue: vi.fn(async () => ({})),
  enqueuePublication: vi.fn(async () => {}),
}));
vi.mock("../../lib/content/locks", async (original) => {
  const actual = await original<typeof import("../../lib/content/locks")>();
  return {
    lockTopicForLearning: vi.fn(actual.lockTopicForLearning),
    lockTopicForChange: vi.fn(actual.lockTopicForChange),
  };
});
const actualLocks = await vi.importActual<
  typeof import("../../lib/content/locks")
>("../../lib/content/locks");
const db = getDb(),
  users: string[] = [],
  demos: string[] = [];
let f: Awaited<ReturnType<typeof createDemoFixture>>;
beforeEach(async () => {
  vi.mocked(locks.lockTopicForLearning)
    .mockImplementation(actualLocks.lockTopicForLearning)
    .mockClear();
  vi.mocked(locks.lockTopicForChange)
    .mockImplementation(actualLocks.lockTopicForChange)
    .mockClear();
  f = await createDemoFixture("stage11");
});
afterEach(async () => {
  await cleanupLessonFixture(f, demos.splice(0), users.splice(0));
});
afterAll(async () => {
  await db.$disconnect();
});
async function student() {
  const row = await db.user.create({
    data: { name: "Синтетический студент", consentPdAt: new Date() },
  });
  users.push(row.id);
  return row.id;
}
function latch<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}
const toInput = (row: TopicDTO): TopicInput => ({
  title: row.title,
  slug: row.slug,
  sectionId: row.sectionId,
  order: row.order,
  isFree: row.isFree,
  contentMd: row.contentMd,
  gapExercises: row.gapExercises,
  readingMinutes: row.readingMinutes,
  authorName: row.authorName,
  reviewerName: row.reviewerName,
  referencesMd: row.referencesMd,
  reviewed: !row.needsExpertReview,
});
async function publish(row: TopicDTO, fields: Partial<TopicInput> = {}) {
  row = await content.updateTopic(row.id, row.editRevision, {
    ...toInput(row),
    ...fields,
    reviewed: true,
  });
  row = await content.setTopicStatus(row.id, row.editRevision, "REVIEW");
  return content.publishTopic(row.id, row.editRevision);
}
async function blockers(pid: number) {
  const [row] = await db.$queryRaw<
    { blockers: number[] }[]
  >`SELECT pg_blocking_pids(${pid}::int) AS blockers`;
  return row.blockers;
}

it("a second student's answer completes while the first student still holds a shared topic lock", async () => {
  const one = await student(),
    two = await student();
  const held = latch<number>(),
    release = latch<void>();
  const reader = db.$transaction(
    async (tx) => {
      await lockLearningActor(tx, { userId: one });
      await locks.lockTopicForLearning(tx, f.free.id);
      const [row] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      held.resolve(row.pid);
      await release.promise;
    },
    { timeout: 30000 },
  );
  const firstPID = await held.promise;
  const nextPID = latch<number>();
  vi.mocked(locks.lockTopicForLearning).mockImplementation(
    async (tx, topicId) => {
      const [row] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      nextPID.resolve(row.pid);
      return actualLocks.lockTopicForLearning(tx, topicId);
    },
  );
  let finished = false;
  const gap = f.free.gap_topicId.find((gap) => gap.order === 0)!;
  const option = shuffledOptions(
    [gap.answer, ...gap.distractors],
    `user:${two}`,
    gap.id,
  )[0];
  const answer = lessons.answerGap(gap.id, { optionIds: [option.id] }, 1, {
    userId: two,
  });
  void answer
    .catch(() => {})
    .finally(() => {
      finished = true;
    });
  try {
    const secondPID = await nextPID.promise;
    // Observe the database lock graph, not an arbitrary elapsed duration.
    while (!finished) expect(await blockers(secondPID)).not.toContain(firstPID);
    expect((await answer).feedback.chosenValues).toEqual([option.text]);
  } finally {
    release.resolve(undefined);
    await reader;
    await answer.catch(() => {});
  }
});

it("publication waits for the learner transaction; old-version answers then receive 409", async () => {
  const userId = await student(),
    held = latch<number>(),
    release = latch<void>();
  await db.topic.update({
    where: { id: f.free.id },
    data: { status: "REVIEW" },
  });
  const reader = db.$transaction(
    async (tx) => {
      await lockLearningActor(tx, { userId });
      await locks.lockTopicForLearning(tx, f.free.id);
      const [row] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      held.resolve(row.pid);
      await release.promise;
    },
    { timeout: 30000 },
  );
  const readerPID = await held.promise,
    started = latch<number>();
  vi.mocked(locks.lockTopicForChange).mockImplementation(
    async (tx, topicId) => {
      const [row] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      started.resolve(row.pid);
      return actualLocks.lockTopicForChange(tx, topicId);
    },
  );
  let finished = false;
  const publishing = content.publishTopic(f.free.id, f.free.editRevision);
  void publishing
    .finally(() => {
      finished = true;
    })
    .catch(() => {});
  try {
    const writerPID = await started.promise;
    while (!(await blockers(writerPID)).includes(readerPID))
      expect(finished).toBe(false);
    expect(finished).toBe(false);
  } finally {
    release.resolve(undefined);
    await reader;
    await publishing.catch(() => {});
  }
  const next = await publishing;
  expect(next.version).toBe(2);
  await expect(
    lessons.answerGap(f.free.gap_topicId[0].id, "outdated", 1, { userId }),
  ).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining("Тема обновлена"),
  });
});

it("migrates a populated legacy lesson and preserves gap, answer, card and progress across wording edits", async () => {
  const userId = await student(),
    actor = { userId };
  const lesson = await lessons.loadLesson(f.free.id, actor),
    gap = lesson.gaps[0];
  await lessons.answerGap(gap.id, { optionIds: [gap.options[0].id] }, 1, actor);
  const answer = await db.gapAnswer.findUniqueOrThrow({
    where: { userId_gapId: { userId, gapId: gap.id } },
  });
  const card = await db.card.findUniqueOrThrow({
    where: { userId_gapId: { userId, gapId: gap.id } },
  });
  const progress = await db.topicProgress.findUniqueOrThrow({
    where: { userId_topicId: { userId, topicId: f.free.id } },
  });
  const raw = await db.topic.findUniqueOrThrow({ where: { id: f.free.id } });
  expect(raw.contentMd).not.toContain("[[#");
  let view = await content.getTopic(f.free.id);
  expect(view.contentMd).toContain(
    `[[#${f.free.gap_topicId.find((source) => source.id === gap.id)!.gapKey} `,
  );
  view = await content.updateTopic(view.id, view.editRevision, toInput(view));
  expect(view.status).toBe("PUBLISHED");
  expect(view.version).toBe(raw.version);
  expect(view.editRevision).toBe(raw.editRevision);
  const migrated = await db.topic.findUniqueOrThrow({
    where: { id: f.free.id },
  });
  expect(migrated.contentMd).toContain("[[#");
  view = await publish(view, {
    contentMd: view.contentMd.replace(
      "Первый выбор",
      "Переформулированный первый выбор",
    ),
  });
  expect(
    (await db.gap.findUniqueOrThrow({ where: { id: gap.id } })).archivedAt,
  ).toBeNull();
  expect(await db.gapAnswer.findUnique({ where: { id: answer.id } })).toEqual(
    answer,
  );
  expect(await db.card.findUnique({ where: { id: card.id } })).toEqual(card);
  expect(
    await db.topicProgress.findUnique({
      where: { userId_topicId: { userId, topicId: f.free.id } },
    }),
  ).toEqual(progress);
  expect(
    (await db.gap.findUniqueOrThrow({ where: { id: gap.id } })).gapKey,
  ).toBe(f.free.gap_topicId.find((g) => g.id === gap.id)!.gapKey);
});

it("resets cards only when correct answers change; keeps first answers, history and progress", async () => {
  const userId = await student(),
    actor = { userId };
  const lesson = await lessons.loadLesson(f.free.id, actor),
    gap = lesson.gaps[0];
  await lessons.answerGap(gap.id, gap.options[0].id, 1, actor);
  let card = await db.card.findUniqueOrThrow({
    where: { userId_gapId: { userId, gapId: gap.id } },
  });
  card = await db.card.update({
    where: { id: card.id },
    data: {
      state: "REVIEW",
      dueAt: new Date(Date.now() + 86400000),
      intervalDays: 5,
      firstShownAt: new Date(),
      revealedAt: new Date(),
      revealedTopicVersion: 1,
    },
  });
  const answer = await db.gapAnswer.findUniqueOrThrow({
    where: { userId_gapId: { userId, gapId: gap.id } },
  });
  const progress = await db.topicProgress.findUniqueOrThrow({
    where: { userId_topicId: { userId, topicId: f.free.id } },
  });
  let view = await content.getTopic(f.free.id);
  view = await publish(view, {
    contentMd: view.contentMd.replace("неверный-один", "другой дистрактор"),
  });
  expect(await db.card.findUnique({ where: { id: card.id } })).toEqual(card);
  const before = Date.now();
  view = await publish(view, {
    contentMd: view.contentMd.replace(" верный-один|", " новый эталон|"),
  });
  const reset = await db.card.findUniqueOrThrow({ where: { id: card.id } });
  expect(reset).toMatchObject({
    state: "NEW",
    suspended: false,
    firstShownAt: null,
    revealedAt: null,
    revealedTopicVersion: null,
    intervalDays: 0,
    revision: card.revision + 1,
  });
  expect(reset.dueAt.getTime()).toBeGreaterThanOrEqual(before);
  expect(reset.dueAt.getTime()).toBeLessThanOrEqual(Date.now());
  expect(await db.gapAnswer.findUnique({ where: { id: answer.id } })).toEqual(
    answer,
  );
  expect(
    await db.topicProgress.findUnique({
      where: { userId_topicId: { userId, topicId: f.free.id } },
    }),
  ).toEqual(progress);
  expect(parseTopic(view.contentMd).gaps[0].gapKey).toBe(
    f.free.gap_topicId.find((g) => g.id === gap.id)!.gapKey,
  );
});

it("saving a pasted duplicate gives only the copy a new ID and copies its exercise settings", async () => {
  const view = await content.getTopic(f.free.id),
    parsed = parseTopic(view.contentMd),
    gap = parsed.gaps[0];
  const source = view.contentMd.slice(gap.start, gap.end);
  const config = {
    answerType: "SINGLE_CHOICE" as const,
    correctAnswers: [gap.answer],
    acceptedAnswers: [],
    explanation: "Настройки исходного пропуска",
  };
  let saved = await content.updateTopic(view.id, view.editRevision, {
    ...toInput(view),
    contentMd: `${view.contentMd}\n\nКопия ${source}.`,
    gapExercises: { ...view.gapExercises, [gap.gapKey]: config },
  });
  const gaps = parseTopic(saved.contentMd).gaps,
    copied = gaps.at(-1)!;
  expect(gaps[0].gapKey).toBe(gap.gapKey);
  expect(copied.gapKey).toMatch(/^[a-z0-9]{6,12}$/);
  expect(copied.gapKey).not.toBe(gap.gapKey);
  expect(saved.gapExercises[copied.gapKey]).toEqual(config);
  expect(saved.gapExercises[gap.gapKey]).toEqual(config);
  saved = await publish(saved);
  const rows = await db.gap.findMany({ where: { topicId: saved.id } });
  expect(rows.find((row) => row.gapKey === gap.gapKey)?.id).toBe(
    f.free.gap_topicId.find((row) => row.gapKey === gap.gapKey)!.id,
  );
  expect(rows.find((row) => row.gapKey === copied.gapKey)?.explanation).toBe(
    config.explanation,
  );
});

it("treats reordered multiple answers as the same set, but resets on a new accepted text answer", async () => {
  await addMixedExercises(f);
  const userId = await student(),
    actor = { userId },
    lesson = await lessons.loadLesson(f.free.id, actor);
  const multi = lesson.gaps.find(
    (gap) => gap.answerType === "MULTIPLE_CHOICE",
  )!;
  const text = lesson.gaps.find((gap) => gap.answerType === "SHORT_TEXT")!;
  await lessons.answerGap(
    multi.id,
    {
      optionIds: multi.options
        .filter((option) => option.text !== "неверный-два")
        .map((option) => option.id),
    },
    1,
    actor,
  );
  await lessons.answerGap(text.id, { text: "ель" }, 1, actor);
  const multiCard = await db.card.findUniqueOrThrow({
    where: { userId_gapId: { userId, gapId: multi.id } },
  });
  const textCard = await db.card.findUniqueOrThrow({
    where: { userId_gapId: { userId, gapId: text.id } },
  });
  const log = await db.reviewLog.create({
    data: {
      cardId: textCard.id,
      cardRevision: 0,
      rating: "GOOD",
      prevIntervalDays: 0,
      newIntervalDays: 1,
    },
  });
  let view = await content.getTopic(f.free.id);
  const parsed = parseTopic(view.contentMd),
    multiKey = parsed.gaps.find((gap) => gap.order === 1)!.gapKey,
    textKey = parsed.gaps.find((gap) => gap.order === 2)!.gapKey;
  view = await publish(view, {
    gapExercises: {
      ...view.gapExercises,
      [multiKey]: {
        ...view.gapExercises[multiKey],
        correctAnswers: [
          ...view.gapExercises[multiKey].correctAnswers,
        ].reverse(),
      },
    },
  });
  expect(await db.card.findUnique({ where: { id: multiCard.id } })).toEqual(
    multiCard,
  );
  expect(await db.card.findUnique({ where: { id: textCard.id } })).toEqual(
    textCard,
  );
  await publish(view, {
    gapExercises: {
      ...view.gapExercises,
      [textKey]: {
        ...view.gapExercises[textKey],
        acceptedAnswers: ["ель", "ёлочка"],
      },
    },
  });
  expect(
    (await db.card.findUniqueOrThrow({ where: { id: textCard.id } })).revision,
  ).toBe(textCard.revision + 1);
  expect(await db.card.findUnique({ where: { id: multiCard.id } })).toEqual(
    multiCard,
  );
  expect(await db.reviewLog.findUnique({ where: { id: log.id } })).toEqual(log);
});

async function learning<T>(topicId: string, action: () => Promise<T>) {
  vi.mocked(locks.lockTopicForLearning).mockClear();
  const result = await action();
  expect(locks.lockTopicForLearning).toHaveBeenCalledWith(
    expect.anything(),
    topicId,
  );
  expect(locks.lockTopicForChange).not.toHaveBeenCalled();
  return result;
}
it("all learner paths call the shared helper: lessons, tests, SRS, tutor, demo and transfer", async () => {
  const userId = await student(),
    actor = { userId };
  const lesson = await learning(f.free.id, () =>
    lessons.loadLesson(f.free.id, actor),
  );
  const gap = lesson.gaps[0];
  await learning(f.free.id, () =>
    lessons.answerGap(gap.id, gap.options[0].id, 1, actor),
  );
  const run = await learning(f.free.id, () =>
    lessons.startTest(f.free.id, 1, actor),
  );
  await learning(f.free.id, () =>
    lessons.answerQuestion(
      f.free.id,
      run.runId!,
      run.questions[0].id,
      "b",
      actor,
    ),
  );
  const card = await db.card.findUniqueOrThrow({
    where: { userId_gapId: { userId, gapId: gap.id } },
  });
  const now = new Date(Math.max(Date.now(), card.dueAt.getTime()) + 1);
  await learning(f.free.id, () =>
    revealCard(userId, card.id, card.revision, 1, now),
  );
  await learning(f.free.id, () =>
    rateCard(userId, card.id, card.revision, 1, "GOOD", now),
  );
  await learning(f.free.id, () =>
    db.$transaction(async (tx) => {
      await lockLearningActor(tx, actor);
      return resolveScope(
        {
          kind: "question",
          topicId: f.free.id,
          text: "Вопрос по теме",
          requestId: newToken(),
        },
        actor,
        tx,
      );
    }),
  );
  const token = newToken(),
    demo = await guestDemo(token);
  demos.push(demo.id);
  await demoAction(demo.id, { action: "goal", goal: "session" });
  await learning(f.free.id, () =>
    demoAction(demo.id, { action: "subject", subjectId: f.subject.id }),
  );
  const row = await db.demoSession.findUniqueOrThrow({
    where: { id: demo.id },
  });
  for (const q of readFlow(row.flow).questions) {
    await learning(q.topicId, () => demoView(demo.id));
    await learning(q.topicId, () =>
      demoAction(demo.id, {
        action: "answer",
        questionId: q.id,
        submission: { optionIds: ["b"] },
      }),
    );
  }
  await learning(f.free.id, () => demoAction(demo.id, { action: "lesson" }));
  const guestLesson = await lessons.loadLesson(f.free.id, {
      demoSessionId: demo.id,
    }),
    guestGap = guestLesson.gaps[0];
  await lessons.answerGap(guestGap.id, guestGap.options[0].id, 1, {
    demoSessionId: demo.id,
  });
  const review = await learning(f.free.id, () =>
    demoAction(demo.id, { action: "review" }),
  );
  await learning(f.free.id, () => demoView(demo.id));
  await learning(f.free.id, () =>
    demoAction(demo.id, { action: "reveal", cardId: review.card!.id }),
  );
  await learning(f.free.id, () =>
    demoAction(demo.id, {
      action: "rate",
      cardId: review.card!.id,
      rating: "GOOD",
    }),
  );
  const target = await student();
  await learning(f.free.id, () => transferGuest(target, { demoToken: token }));
});
