import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, afterAll, it, expect, vi } from "vitest";
import sharp from "sharp";
import { getDb } from "../../lib/db";
import { getEnv } from "../../lib/env";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import { createStorageDriver } from "../../lib/storage";
import { currentLegal } from "../../lib/auth/legal";
import { uploadTopicImage, readTopicImage } from "../../lib/content/images";
import { imageMarkdown } from "../../lib/content/image-reference";
import * as content from "../../lib/content/service";
import {
  getContentQueue,
  closeContentQueue,
  CONTENT_INDEX_QUEUE,
} from "../../lib/content/jobs";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
vi.mock("../../lib/settings", () => ({
  getSetting: async (k: keyof typeof DEFAULT_SETTINGS) => DEFAULT_SETTINGS[k],
}));
const db = getDb(),
  users: string[] = [];
let f: LessonFixture,
  other: LessonFixture,
  admin: string,
  teacher: string,
  student: string,
  png: Buffer;
async function user(role: "ADMIN" | "EDITOR" | "USER") {
  const docs = await currentLegal(),
    u = await db.user.create({
      data: {
        email: `authoring-${randomUUID()}@example.test`,
        name: "Проверка изображений",
        role,
        consentPdAt: new Date(),
        consentPdVersion: docs.consent.version,
        offerVersion: docs.offer.version,
      },
    });
  users.push(u.id);
  return u.id;
}
async function publish(topicId: string, md: string) {
  const row = await content.getTopic(topicId),
    {
      title,
      slug,
      sectionId,
      order,
      isFree,
      readingMinutes,
      authorName,
      reviewerName,
      referencesMd,
      gapExercises,
    } = row;
  const changed = await content.updateTopic(
    topicId,
    row.editRevision,
    {
      title,
      slug,
      sectionId,
      order,
      isFree,
      contentMd: md,
      readingMinutes,
      authorName,
      reviewerName,
      referencesMd,
      gapExercises,
      reviewed: true,
    },
    admin,
  );
  const review = await content.setTopicStatus(
    topicId,
    changed.editRevision,
    "REVIEW",
    admin,
  );
  return content.publishTopic(topicId, review.editRevision, admin);
}
beforeEach(async () => {
  f = await createLessonFixture("authoring");
  other = await createLessonFixture("authoring-other");
  admin = await user("ADMIN");
  teacher = await user("EDITOR");
  student = await user("USER");
  await db.teacherSubject.create({
    data: { teacherId: teacher, subjectId: f.subject.id, assignedById: admin },
  });
  png = await sharp({
    create: { width: 40, height: 20, channels: 3, background: "#08634f" },
  })
    .png()
    .toBuffer();
});
afterEach(async () => {
  const topicIds = [f.free.id, f.paid.id, other.free.id, other.paid.id],
    images = await db.topicImage.findMany({
      where: { topicId: { in: topicIds } },
      select: { storageKey: true },
    });
  const queue = await getContentQueue();
  for (const id of topicIds) {
    const rows = await db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM pgboss.job WHERE name=${CONTENT_INDEX_QUEUE} AND data->>'topicId'=${id}`;
    if (rows.length)
      await queue.deleteJob(
        CONTENT_INDEX_QUEUE,
        rows.map((r) => r.id),
      );
  }
  await cleanupLessonFixture(other);
  await cleanupLessonFixture(f, [], users.splice(0));
  for (const image of images)
    await createStorageDriver(getEnv()).remove(image.storageKey);
});
afterAll(async () => {
  await closeContentQueue();
  await db.$disconnect();
});
it("allows assigned teachers to upload, rejects students and unrelated subjects before writing files", async () => {
  await expect(
    uploadTopicImage(student, f.free.id, png, "image/png"),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    uploadTopicImage(teacher, other.free.id, png, "image/png"),
  ).rejects.toMatchObject({ status: 404 });
  const image = await uploadTopicImage(teacher, f.free.id, png, "image/png");
  expect(image).toMatchObject({ width: 40, height: 20 });
  const bytes = await readTopicImage(image.id, teacher);
  expect((await sharp(bytes.body).metadata()).format).toBe("webp");
  expect(await db.topicImage.count({ where: { topicId: f.free.id } })).toBe(1);
});
it("serves an image in a published free lesson but hides drafts and detached assets", async () => {
  const image = await uploadTopicImage(admin, f.free.id, png, "image/png");
  await expect(readTopicImage(image.id, null)).rejects.toMatchObject({
    status: 404,
  });
  await publish(
    f.free.id,
    f.free.contentMd +
      "\n\n" +
      imageMarkdown(image.id, "Учебная схема", image.width, image.height),
  );
  expect((await readTopicImage(image.id, null)).body.length).toBeGreaterThan(0);
  const row = await content.getTopic(f.free.id);
  await content.setTopicStatus(f.free.id, row.editRevision, "DRAFT", admin);
  await expect(readTopicImage(image.id, student)).rejects.toMatchObject({
    status: 404,
  });
  expect((await readTopicImage(image.id, teacher)).body.length).toBeGreaterThan(
    0,
  );
});
it("uses the same paid access rules and immediately respects grant revocation", async () => {
  const image = await uploadTopicImage(admin, f.paid.id, png, "image/png");
  await publish(
    f.paid.id,
    f.paid.contentMd +
      "\n\n" +
      imageMarkdown(image.id, "Платная учебная схема"),
  );
  await expect(readTopicImage(image.id, null)).rejects.toMatchObject({
    status: 404,
  });
  await expect(readTopicImage(image.id, student)).rejects.toMatchObject({
    status: 404,
  });
  const grant = await db.accessGrant.create({
    data: {
      userId: student,
      subjectId: f.subject.id,
      grantedById: admin,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  expect((await readTopicImage(image.id, student)).body.length).toBeGreaterThan(
    0,
  );
  await db.accessGrant.update({
    where: { id: grant.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await expect(readTopicImage(image.id, student)).rejects.toMatchObject({
    status: 404,
  });
});
it("rejects publication with another topic's image or a missing image", async () => {
  const image = await uploadTopicImage(admin, f.free.id, png, "image/png");
  await expect(
    publish(
      other.free.id,
      other.free.contentMd + "\n\n" + imageMarkdown(image.id, "Чужая схема"),
    ),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    publish(
      other.free.id,
      other.free.contentMd +
        "\n\n" +
        imageMarkdown(randomUUID(), "Неизвестная схема"),
    ),
  ).rejects.toMatchObject({ status: 422 });
});
it("rechecks assignments on subsequent reads and uploads", async () => {
  await db.topic.update({
    where: { id: f.free.id },
    data: { status: "DRAFT" },
  });
  const image = await uploadTopicImage(teacher, f.free.id, png, "image/png");
  await db.teacherSubject.delete({
    where: {
      teacherId_subjectId: { teacherId: teacher, subjectId: f.subject.id },
    },
  });
  await expect(readTopicImage(image.id, teacher)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    uploadTopicImage(teacher, f.free.id, png, "image/png"),
  ).rejects.toMatchObject({ status: 404 });
});
it("removes image objects only after a successful topic deletion", async () => {
  await db.topic.update({
    where: { id: f.free.id },
    data: { status: "DRAFT" },
  });
  const image = await uploadTopicImage(admin, f.free.id, png, "image/png"),
    stored = await db.topicImage.findUniqueOrThrow({ where: { id: image.id } }),
    row = await content.getTopic(f.free.id);
  await expect(
    content.deleteTopic(f.free.id, row.editRevision + 1, admin),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await createStorageDriver(getEnv()).get(stored.storageKey)).length,
  ).toBeGreaterThan(0);
  await content.deleteTopic(f.free.id, row.editRevision, admin);
  expect(
    await db.topicImage.findUnique({ where: { id: image.id } }),
  ).toBeNull();
  await expect(
    createStorageDriver(getEnv()).get(stored.storageKey),
  ).rejects.toThrow();
});
