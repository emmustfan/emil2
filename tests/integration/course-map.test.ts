import { afterEach, afterAll, beforeEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db";
import { courseMapTopics } from "../../lib/ui/course-map";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
const db = getDb();
let fixture: LessonFixture;
const users: string[] = [];
beforeEach(async () => {
  fixture = await createLessonFixture("course-map");
  const min = await db.subject.aggregate({ _min: { order: true } });
  await db.subject.update({
    where: { id: fixture.subject.id },
    data: { order: (min._min.order ?? 0) - 1 },
  });
});
afterEach(async () => {
  await cleanupLessonFixture(fixture, [], users.splice(0));
});
afterAll(async () => {
  await db.$disconnect();
});
test("public map excludes material awaiting review and subjects removed from publication", async () => {
  const own = async () =>
    (await courseMapTopics()).filter((topic) =>
      [fixture.free.id, fixture.paid.id].includes(topic.id),
    );
  expect(await own()).toHaveLength(2);
  await db.topic.update({
    where: { id: fixture.free.id },
    data: { needsExpertReview: true },
  });
  await db.topic.update({
    where: { id: fixture.paid.id },
    data: { reviewedAt: null },
  });
  expect(await own()).toHaveLength(0);
  await db.topic.updateMany({
    where: { subjectId: fixture.subject.id },
    data: { needsExpertReview: false, reviewedAt: new Date() },
  });
  await db.subject.update({
    where: { id: fixture.subject.id },
    data: { status: "DRAFT" },
  });
  expect(await own()).toHaveLength(0);
});
test("map exposes only topic metadata and the current learner's progress", async () => {
  for (let i = 0; i < 2; i++) {
    const user = await db.user.create({
      data: {
        email: `course-map-${randomUUID()}@example.test`,
        name: "Проверка карты",
      },
    });
    users.push(user.id);
  }
  await db.topicProgress.create({
    data: {
      userId: users[0],
      topicId: fixture.free.id,
      gapsAnswered: 1,
      completedAt: new Date(),
    },
  });
  await db.topicProgress.create({
    data: {
      userId: users[1],
      topicId: fixture.paid.id,
      gapsAnswered: 1,
      completedAt: new Date(),
    },
  });
  const first = await courseMapTopics(users[0]),
    second = await courseMapTopics(users[1]),
    anonymous = await courseMapTopics();
  expect(first.find((t) => t.id === fixture.free.id)?.completed).toBe(true);
  expect(second.find((t) => t.id === fixture.free.id)?.completed).toBe(false);
  expect(first.find((t) => t.id === fixture.paid.id)?.completed).toBe(false);
  expect(second.find((t) => t.id === fixture.paid.id)?.completed).toBe(true);
  expect(anonymous.some((t) => t.completed || t.started)).toBe(false);
  const wire = JSON.stringify(first);
  for (const secret of [
    ...users,
    fixture.paid.contentMd,
    "correctOptionIds",
    "gapExercises",
    "referencesMd",
    "email",
  ])
    expect(wire).not.toContain(secret);
});
