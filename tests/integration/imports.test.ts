import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, afterAll, it, expect, vi } from "vitest";
import { getDb } from "../../lib/db";
import { getEnv } from "../../lib/env";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import { currentLegal } from "../../lib/auth/legal";
import { createStorageDriver } from "../../lib/storage";
import {
  createImport,
  getImport,
  listImports,
} from "../../lib/imports/service";
import { processImport, importTick } from "../../lib/imports/worker";
import {
  CONTENT_IMPORT_QUEUE,
  getContentQueue,
  closeContentQueue,
} from "../../lib/content/jobs";
import { getTopic, publishTopic, deleteTopic } from "../../lib/content/service";
import { parseTopic } from "../../lib/content/parse";
import { MockLLMProvider } from "../../lib/llm";
import { sourcePdf, sourceDocx, sourceText } from "../helpers/import-fixture";
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
  student: string;
async function user(role: "ADMIN" | "EDITOR" | "USER") {
  const legal = await currentLegal(),
    row = await db.user.create({
      data: {
        email: `imports-${randomUUID()}@example.test`,
        role,
        name: "Проверка импорта",
        consentPdAt: new Date(),
        consentPdVersion: legal.consent.version,
        offerVersion: legal.offer.version,
      },
    });
  users.push(row.id);
  return row.id;
}
beforeEach(async () => {
  f = await createLessonFixture("imports");
  other = await createLessonFixture("imports-other");
  admin = await user("ADMIN");
  teacher = await user("EDITOR");
  student = await user("USER");
  await db.teacherSubject.create({
    data: { teacherId: teacher, subjectId: f.subject.id, assignedById: admin },
  });
});
afterEach(async () => {
  const jobs = await db.importJob.findMany({
      where: { createdById: { in: users } },
    }),
    queue = await getContentQueue();
  for (const job of jobs) {
    const rows = await db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM pgboss.job WHERE name=${CONTENT_IMPORT_QUEUE} AND data->>'id'=${job.id}`;
    if (rows.length)
      await queue.deleteJob(
        CONTENT_IMPORT_QUEUE,
        rows.map((r) => r.id),
      );
    for (const id of job.topicIds) {
      const topic = await db.topic.findUnique({ where: { id } });
      if (topic) await deleteTopic(id, topic.editRevision, admin);
    }
    await createStorageDriver(getEnv()).remove(job.fileKey);
  }
  await db.importJob.deleteMany({ where: { createdById: { in: users } } });
  await db.teacherSubject.deleteMany({
    where: {
      OR: [{ teacherId: { in: users } }, { assignedById: { in: users } }],
    },
  });
  await cleanupLessonFixture(other);
  await cleanupLessonFixture(f, [], users.splice(0));
});
afterAll(async () => {
  await closeContentQueue();
  await db.$disconnect();
});
it("imports a real five-page PDF exactly once, persists diagnostics and keeps expert publication gate", async () => {
  const { id } = await createImport(
    teacher,
    {
      subjectId: f.subject.id,
      sectionId: f.free.sectionId!,
      rightsConfirmed: true,
    },
    "source.pdf",
    sourcePdf(),
  );
  await Promise.all([processImport(id), processImport(id)]);
  const job = await getImport(admin, id);
  expect(job.status).toBe("done");
  expect(job.topics).toHaveLength(1);
  const topic = await getTopic(job.topics[0].id);
  expect(
    await db.topic.findUniqueOrThrow({ where: { id: topic.id } }),
  ).toMatchObject({
    status: "DRAFT",
    aiGenerated: true,
    needsExpertReview: true,
    reviewedAt: null,
    sectionId: f.free.sectionId!,
  });
  expect(parseTopic(topic.contentMd).gaps.length).toBeGreaterThanOrEqual(15);
  expect(topic.questions).toHaveLength(10);
  expect(topic.questions.filter((q) => q.isDiagnostic)).toHaveLength(3);
  await expect(
    publishTopic(topic.id, topic.editRevision, teacher),
  ).rejects.toThrow("проверена экспертом");
  await processImport(id);
  expect((await getImport(teacher, id)).topics).toHaveLength(1);
  const record = await db.importJob.findUniqueOrThrow({ where: { id } });
  expect(record.sourceDeletedAt).not.toBeNull();
  await expect(
    createStorageDriver(getEnv()).get(record.fileKey),
  ).rejects.toThrow();
});
it("accepts DOCX, text and creates multiple atomic drafts for a long source", async () => {
  const one = await createImport(
    admin,
    { subjectId: f.subject.id, sectionId: null, rightsConfirmed: true },
    "source.docx",
    sourceDocx(),
  );
  await processImport(one.id);
  expect((await getImport(admin, one.id)).status).toBe("done");
  const two = await createImport(
    admin,
    { subjectId: f.subject.id, sectionId: null, rightsConfirmed: true },
    "source.txt",
    Buffer.from(sourceText.repeat(4)),
  );
  await processImport(two.id);
  const job = await getImport(admin, two.id);
  expect(job.status).toBe("done");
  expect(job.topics.length).toBeGreaterThan(1);
  expect(job.partsDone).toBe(job.partsTotal);
});
it("rejects missing rights, students, wrong sections and unrelated teacher scope", async () => {
  const input = {
    subjectId: f.subject.id,
    sectionId: null,
    rightsConfirmed: true,
  };
  await expect(
    createImport(
      teacher,
      { ...input, rightsConfirmed: false },
      "a.txt",
      Buffer.from(sourceText),
    ),
  ).rejects.toThrow();
  await expect(
    createImport(student, input, "a.txt", Buffer.from(sourceText)),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    createImport(
      teacher,
      { ...input, subjectId: other.subject.id },
      "a.txt",
      Buffer.from(sourceText),
    ),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    createImport(
      teacher,
      { ...input, sectionId: other.free.sectionId! },
      "a.txt",
      Buffer.from(sourceText),
    ),
  ).rejects.toMatchObject({ status: 404 });
  const job = await createImport(
    admin,
    { ...input, subjectId: other.subject.id },
    "a.txt",
    Buffer.from(sourceText),
  );
  await expect(getImport(teacher, job.id)).rejects.toMatchObject({
    status: 404,
  });
  expect(await listImports(teacher)).toHaveLength(0);
});
it("returns a clear scan error and removes the source without creating topics", async () => {
  const { id } = await createImport(
    teacher,
    { subjectId: f.subject.id, sectionId: null, rightsConfirmed: true },
    "scan.pdf",
    sourcePdf(true),
  );
  await processImport(id);
  const job = await getImport(teacher, id);
  expect(job).toMatchObject({ status: "failed", topics: [] });
  expect(job.error).toContain("Нужен файл с текстом");
  expect(
    (await db.importJob.findUniqueOrThrow({ where: { id } })).sourceDeletedAt,
  ).not.toBeNull();
});
it("rechecks teaching assignment after generation and rolls back all drafts", async () => {
  const { id } = await createImport(
      teacher,
      { subjectId: f.subject.id, sectionId: null, rightsConfirmed: true },
      "source.txt",
      Buffer.from(sourceText),
    ),
    llm = new MockLLMProvider(8),
    original = llm.complete.bind(llm);
  vi.spyOn(llm, "complete").mockImplementation(async (messages, options) => {
    const result = await original(messages, options);
    await db.teacherSubject.deleteMany({ where: { teacherId: teacher } });
    return result;
  });
  await processImport(id, llm);
  expect(await getImport(admin, id)).toMatchObject({
    status: "failed",
    topics: [],
  });
  expect(
    await db.topic.count({
      where: { subjectId: f.subject.id, aiGenerated: true },
    }),
  ).toBe(0);
});
it("recovers a lost expired lease, but not a live lease; retry never duplicates drafts", async () => {
  const { id } = await createImport(
    admin,
    { subjectId: f.subject.id, sectionId: null, rightsConfirmed: true },
    "source.txt",
    Buffer.from(sourceText),
  );
  await db.importJob.update({
    where: { id },
    data: {
      status: "processing",
      runToken: "lost",
      attempts: 1,
      leaseUntil: new Date(Date.now() + 60000),
    },
  });
  await processImport(id);
  expect((await getImport(admin, id)).status).toBe("processing");
  await db.importJob.update({
    where: { id },
    data: { leaseUntil: new Date(0) },
  });
  await importTick();
  await processImport(id);
  expect((await getImport(admin, id)).status).toBe("done");
});
it("does not create partial topics when a later part fails twice", async () => {
  const { id } = await createImport(
      teacher,
      { subjectId: f.subject.id, sectionId: null, rightsConfirmed: true },
      "source.txt",
      Buffer.from(sourceText.repeat(4)),
    ),
    llm = new MockLLMProvider(8),
    original = llm.complete.bind(llm);
  const complete = vi.spyOn(llm, "complete");
  complete
    .mockImplementationOnce(original)
    .mockResolvedValue({ text: "{}", tokensIn: 1, tokensOut: 1 });
  await processImport(id, llm);
  expect(complete).toHaveBeenCalledTimes(3);
  expect(await getImport(admin, id)).toMatchObject({
    status: "failed",
    topics: [],
  });
  expect(
    await db.topic.count({
      where: { subjectId: f.subject.id, aiGenerated: true },
    }),
  ).toBe(0);
});
it("limits concurrent imports and creates the queue record in the same database transaction", async () => {
  const input = {
    subjectId: f.subject.id,
    sectionId: null,
    rightsConfirmed: true,
  };
  const a = await createImport(
    teacher,
    input,
    "a.txt",
    Buffer.from(sourceText),
  );
  await createImport(teacher, input, "b.txt", Buffer.from(sourceText));
  await expect(
    createImport(teacher, input, "c.txt", Buffer.from(sourceText)),
  ).rejects.toMatchObject({ status: 429 });
  const queueRows = await db.$queryRaw<
    { id: string }[]
  >`SELECT id FROM pgboss.job WHERE name=${CONTENT_IMPORT_QUEUE} AND data->>'id'=${a.id}`;
  expect(queueRows).toHaveLength(1);
});
