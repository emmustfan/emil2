import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDb } from "../../lib/db";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
import {
  getManagedUser,
  listUsers,
  updateUserAccess,
  userFilters,
} from "../../lib/admin/users";
import * as content from "../../lib/content/service";
import type {
  TopicInput,
  QuestionInput,
  SubjectInput,
} from "../../lib/content/validation";
import type { TopicDTO } from "../../lib/content/types";
import {
  getContentQueue,
  CONTENT_INDEX_QUEUE,
  closeContentQueue,
} from "../../lib/content/jobs";
import { createSession, findSession } from "../../lib/auth/session";
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    DEFAULT_SETTINGS[key],
}));
const db = getDb();
let f: LessonFixture,
  other: LessonFixture,
  admin: string,
  secondAdmin: string,
  teacher: string,
  student: string,
  prefix: string;
const users: string[] = [];
async function user(role: "USER" | "EDITOR" | "ADMIN", verified = true) {
  const u = await db.user.create({
    data: {
      email: `${prefix}-${role}-${randomUUID()}@example.test`,
      emailVerifiedAt: verified ? new Date() : null,
      name: `${prefix} ${role}`,
      role,
    },
  });
  users.push(u.id);
  return u.id;
}
function fields(t: TopicDTO): TopicInput {
  return {
    title: t.title,
    slug: t.slug,
    sectionId: t.sectionId,
    order: t.order,
    isFree: t.isFree,
    contentMd: t.contentMd,
    gapExercises: t.gapExercises,
    readingMinutes: t.readingMinutes,
    authorName: t.authorName,
    reviewerName: t.reviewerName,
    referencesMd: t.referencesMd,
    reviewed: !t.needsExpertReview,
  };
}
async function assign(ids = [f.subject.id]) {
  const u = await db.user.findUniqueOrThrow({ where: { id: teacher } });
  return updateUserAccess(admin, teacher, {
    revision: u.roleRevision,
    role: "EDITOR",
    blocked: false,
    subjectIds: ids,
  });
}
beforeEach(async () => {
  prefix = `roles-${randomUUID()}`;
  f = await createLessonFixture("roles-own");
  other = await createLessonFixture("roles-other");
  admin = await user("ADMIN");
  secondAdmin = await user("ADMIN");
  teacher = await user("EDITOR");
  student = await user("USER");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  const queue = await getContentQueue();
  for (const topicId of [f.free.id, f.paid.id, other.free.id, other.paid.id]) {
    const rows = await db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM pgboss.job WHERE name=${CONTENT_INDEX_QUEUE} AND data->>'topicId'=${topicId}`;
    if (rows.length)
      await queue.deleteJob(
        CONTENT_INDEX_QUEUE,
        rows.map((r) => r.id),
      );
  }
  await cleanupLessonFixture(f);
  await cleanupLessonFixture(other, [], users.splice(0));
});
afterAll(async () => {
  await closeContentQueue();
  await db.$disconnect();
});
it("gives an existing teacher no implicit global access and filters lists before counts/pagination", async () => {
  expect((await content.listSubjects("", 1, teacher)).items).toHaveLength(0);
  await assign();
  const data = await content.listSubjects("", 1, teacher);
  expect(data.items.map((s) => s.id)).toEqual([f.subject.id]);
  expect(data.total).toBe(1);
  expect((await content.getTopic(f.free.id, undefined, teacher)).id).toBe(
    f.free.id,
  );
  for (const fn of [
    () => content.getSubject(other.subject.id, teacher),
    () => content.listTopics(other.subject.id, "", 1, teacher),
    () => content.listSections(other.subject.id, teacher),
    () => content.getTopic(other.free.id, undefined, teacher),
    () => content.getSection(other.free.sectionId!, teacher),
    () => content.getQuestion(other.free.question_topicId[0].id, teacher),
  ])
    await expect(fn()).rejects.toMatchObject({ status: 404 });
  await expect(content.getSubject(f.subject.id, student)).rejects.toMatchObject(
    { status: 403 },
  );
  expect((await content.getTopic(other.free.id, undefined, admin)).id).toBe(
    other.free.id,
  );
});
it("checks every topic, section and question mutation against the current assignment", async () => {
  await assign();
  const target = await content.getTopic(other.free.id),
    input = fields(target),
    q = target.questions[0];
  const question: QuestionInput = {
    answerType: q.answerType,
    acceptedAnswers: q.acceptedAnswers,
    stem: q.stem,
    options: q.options,
    correctOptionIds: q.correctOptionIds,
    explanation: q.explanation,
    sourceBlockKey: q.sourceBlockKey,
    isDiagnostic: q.isDiagnostic,
    order: q.order,
  };
  for (const fn of [
    () =>
      content.createSection(
        other.subject.id,
        { title: "No access", order: 0 },
        teacher,
      ),
    () =>
      content.updateSection(
        other.free.sectionId!,
        0,
        { title: "No access", order: 0 },
        teacher,
      ),
    () => content.deleteSection(other.free.sectionId!, 0, teacher),
    () =>
      content.createTopic(
        other.subject.id,
        { ...input, sectionId: null, slug: "blocked" },
        teacher,
      ),
    () => content.updateTopic(target.id, target.editRevision, input, teacher),
    () => content.deleteTopic(target.id, target.editRevision, teacher),
    () =>
      content.setTopicStatus(target.id, target.editRevision, "REVIEW", teacher),
    () => content.publishTopic(target.id, target.editRevision, teacher),
    () =>
      content.createQuestion(target.id, target.editRevision, question, teacher),
    () => content.updateQuestion(q.id, target.editRevision, question, teacher),
    () => content.deleteQuestion(q.id, target.editRevision, teacher),
  ])
    await expect(fn()).rejects.toMatchObject({ status: 404 });
  expect((await content.getTopic(target.id)).status).toBe("PUBLISHED");
  expect((await content.getTopic(target.id)).questions).toHaveLength(5);
});
it("lets a teacher create assignments and publish in their subject, while reserving subject administration to admins", async () => {
  await assign();
  const section = await content.createSection(
    f.subject.id,
    { title: "Раздел учителя", order: 1 },
    teacher,
  );
  await content.updateSection(
    section.id,
    0,
    { title: "Изменённый раздел", order: 1 },
    teacher,
  );
  await content.deleteSection(section.id, 1, teacher);
  let t = await content.getTopic(f.free.id, undefined, teacher);
  t = await content.updateTopic(
    t.id,
    t.editRevision,
    { ...fields(t), title: "Материал учителя", reviewed: true },
    teacher,
  );
  t = await content.setTopicStatus(t.id, t.editRevision, "REVIEW", teacher);
  t = await content.publishTopic(t.id, t.editRevision, teacher);
  expect(t.status).toBe("PUBLISHED");
  expect(t.title).toBe("Материал учителя");
  const subject: SubjectInput = {
    title: f.subject.title,
    slug: f.subject.slug,
    shortDescription: f.subject.shortDescription,
    descriptionMd: f.subject.descriptionMd,
    courses: f.subject.courses,
    order: f.subject.order,
    status: f.subject.status,
    seoTitle: f.subject.seoTitle,
    seoDescription: f.subject.seoDescription,
  };
  for (const fn of [
    () => content.createSubject(subject, teacher),
    () => content.updateSubject(f.subject.id, 0, subject, teacher),
    () => content.deleteSubject(f.subject.id, 0, teacher),
  ])
    await expect(fn()).rejects.toMatchObject({ status: 403 });
});
it("revokes an assignment immediately, preserves material and records the before/after access", async () => {
  const granted = await assign();
  expect(granted.user.roleRevision).toBe(1);
  expect(granted.audit).toHaveLength(1);
  const removed = await assign([]);
  expect(removed.user.roleRevision).toBe(2);
  expect(removed.audit).toHaveLength(2);
  await expect(
    content.updateTopic(
      f.free.id,
      0,
      { ...fields(await content.getTopic(f.free.id)), title: "Forbidden" },
      teacher,
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect((await content.getTopic(f.free.id)).title).toBe(f.free.title);
  expect(removed.audit[0].changes).toMatchObject({
    before: { subjectIds: [f.subject.id] },
    after: { subjectIds: [] },
  });
});
it("rejects forged, unverified, stale and non-admin access changes without modifying data", async () => {
  const unverified = await user("USER", false);
  await expect(
    updateUserAccess(admin, unverified, {
      revision: 0,
      role: "EDITOR",
      blocked: false,
      subjectIds: [],
    }),
  ).rejects.toMatchObject({ status: 409 });
  for (const actor of [teacher, student]) {
    await expect(listUsers(actor, userFilters.parse({}))).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(getManagedUser(actor, admin)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      updateUserAccess(actor, student, {
        revision: 0,
        role: "ADMIN",
        blocked: false,
        subjectIds: [],
      }),
    ).rejects.toMatchObject({ status: 403 });
  }
  await assign();
  await expect(
    updateUserAccess(admin, teacher, {
      revision: 0,
      role: "USER",
      blocked: false,
      subjectIds: [],
    }),
  ).rejects.toMatchObject({ status: 409, code: "stale" });
  await expect(
    updateUserAccess(admin, teacher, {
      revision: 1,
      role: "EDITOR",
      blocked: false,
      subjectIds: ["unknown-subject"],
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await getManagedUser(admin, teacher)).assignments.map((a) => a.subjectId),
  ).toEqual([f.subject.id]);
});
it("serializes competing admins and never overwrites a newer access edit", async () => {
  const result = await Promise.allSettled([
    updateUserAccess(admin, student, {
      revision: 0,
      role: "EDITOR",
      blocked: false,
      subjectIds: [f.subject.id],
    }),
    updateUserAccess(secondAdmin, student, {
      revision: 0,
      role: "USER",
      blocked: true,
      subjectIds: [],
    }),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(result.find((r) => r.status === "rejected")).toMatchObject({
    reason: { status: 409 },
  });
  expect(await db.securityAudit.count({ where: { targetId: student } })).toBe(
    1,
  );
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: student } })).roleRevision,
  ).toBe(1);
});
it("protects self and configured owners, and clears assignments when a teacher becomes a student", async () => {
  await expect(
    updateUserAccess(admin, admin, {
      revision: 0,
      role: "USER",
      blocked: false,
      subjectIds: [],
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    updateUserAccess(admin, admin, {
      revision: 0,
      role: "ADMIN",
      blocked: true,
      subjectIds: [],
    }),
  ).rejects.toMatchObject({ status: 409 });
  const owner = await db.user.findUniqueOrThrow({ where: { id: secondAdmin } });
  vi.stubEnv("ADMIN_EMAILS", owner.email!);
  await expect(
    updateUserAccess(admin, secondAdmin, {
      revision: 0,
      role: "USER",
      blocked: false,
      subjectIds: [],
    }),
  ).rejects.toMatchObject({ status: 409 });
  await assign();
  await updateUserAccess(admin, teacher, {
    revision: 1,
    role: "USER",
    blocked: false,
    subjectIds: [],
  });
  expect(await db.teacherSubject.count({ where: { teacherId: teacher } })).toBe(
    0,
  );
  await expect(
    content.getTopic(f.free.id, undefined, teacher),
  ).rejects.toMatchObject({ status: 403 });
  expect(await db.topic.count({ where: { id: f.free.id } })).toBe(1);
});
it("blocks login and revokes sessions, including one being created concurrently, without restoring them on unblock", async () => {
  await assign();
  let ready!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
      ready = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    });
  const login = db.$transaction(async (tx) => {
    const session = await createSession(tx, teacher, 1, 5);
    ready();
    await wait;
    return session;
  });
  await entered;
  const blocking = updateUserAccess(admin, teacher, {
    revision: 1,
    role: "EDITOR",
    blocked: true,
    subjectIds: [f.subject.id],
  });
  release();
  const [session] = await Promise.all([login, blocking]);
  expect(await findSession(session.token)).toBeNull();
  expect(await db.session.count({ where: { userId: teacher } })).toBe(0);
  await expect(
    db.$transaction((tx) => createSession(tx, teacher, 1, 5)),
  ).rejects.toThrow();
  await updateUserAccess(admin, teacher, {
    revision: 2,
    role: "EDITOR",
    blocked: false,
    subjectIds: [f.subject.id],
  });
  expect(await findSession(session.token)).toBeNull();
  const fresh = await db.$transaction((tx) => createSession(tx, teacher, 1, 5));
  expect((await findSession(fresh.token))?.user.role).toBe("EDITOR");
});
it("filters account search and returns an explicit management projection", async () => {
  const result = await listUsers(
    admin,
    userFilters.parse({ q: prefix, role: "EDITOR", state: "ACTIVE" }),
  );
  expect(result.items.map((u) => u.id)).toEqual([teacher]);
  const wire = JSON.stringify(result);
  for (const field of [
    "tokenHash",
    "consentPdVersion",
    "offerVersion",
    "loginToken",
    "session_userId",
  ])
    expect(wire).not.toContain(field);
  expect((await getManagedUser(admin, teacher)).user).toMatchObject({
    role: "EDITOR",
    roleRevision: 0,
    owner: false,
  });
  await assign();
  await updateUserAccess(admin, teacher, {
    revision: 1,
    role: "EDITOR",
    blocked: true,
    subjectIds: [f.subject.id],
  });
  expect(
    (
      await listUsers(admin, userFilters.parse({ q: prefix, state: "BLOCKED" }))
    ).items.map((u) => u.id),
  ).toEqual([teacher]);
});
it("rechecks the acting administrator under the access lock during reciprocal demotions", async () => {
  const replies = await Promise.allSettled([
    updateUserAccess(admin, secondAdmin, {
      revision: 0,
      role: "USER",
      blocked: false,
      subjectIds: [],
    }),
    updateUserAccess(secondAdmin, admin, {
      revision: 0,
      role: "USER",
      blocked: false,
      subjectIds: [],
    }),
  ]);
  expect(replies.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(replies.find((r) => r.status === "rejected")).toMatchObject({
    reason: { status: 403 },
  });
  const roles = await db.user.findMany({
    where: { id: { in: [admin, secondAdmin] } },
    select: { role: true },
  });
  expect(roles.filter((u) => u.role === "ADMIN")).toHaveLength(1);
  expect(
    await db.securityAudit.count({
      where: { targetId: { in: [admin, secondAdmin] } },
    }),
  ).toBe(1);
});
