import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "../../app/api/groups/[...path]/route";
import { getEnv } from "../../lib/env";
import { getDb } from "../../lib/db";
import { currentGroupNotice } from "../../lib/groups/notice";
import { staffGroup } from "../../lib/groups/queries";
import { groupDirectory } from "../../lib/org/groups";
import { can } from "../../lib/org";
import { answerGap, loadLesson } from "../../lib/lessons/service";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import { createOrgFixture, type OrgFixture } from "../helpers/org-fixture";

const state = vi.hoisted(() => ({ actorId: "" }));
vi.mock("../../lib/auth/server", () => ({
  getCurrentSession: async () => {
    const { getDb } = await import("../../lib/db");
    const user = await getDb().user.findUnique({
      where: { id: state.actorId },
    });
    return user ? { user, userId: user.id } : null;
  },
}));
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    DEFAULT_SETTINGS[key],
}));

const db = getDb();
let fixture: OrgFixture;
let testIp: string;
let ips: Set<string>;
beforeEach(async () => {
  vi.stubEnv("TRUST_PROXY", "true");
  testIp = "10." + Array.from(randomBytes(3)).join(".");
  ips = new Set([testIp]);
  fixture = await createOrgFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await db.usageCounter.deleteMany({
    where: {
      feature: "group.join",
      actorKey: { in: [...ips].map((ip) => `ip:${ip}`) },
    },
  });
  await fixture.cleanup();
});
afterAll(async () => {
  await db.$disconnect();
});

async function post(actorId: string, path: string, input: object, ip = testIp) {
  state.actorId = actorId;
  ips.add(ip);
  const url = new URL("/api/groups/" + path, getEnv().APP_URL);
  return POST(
    new Request(url, {
      method: "POST",
      headers: {
        origin: url.origin,
        "content-type": "application/json",
        "x-real-ip": ip,
      },
      body: JSON.stringify(input),
    }),
    { params: Promise.resolve({ path: path.split("/") }) },
  );
}

async function ok(response: Response, status = 200) {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(status);
  return body;
}

async function group(name: string, requireApproval = true) {
  const f = fixture;
  const { id } = await ok(
    await post(f.admin.id, "create", {
      facultyId: f.faculty.id,
      name,
      course: 1,
      academicYear: "2026/2027",
      requireApproval,
    }),
    201,
  );
  await ok(await post(f.admin.id, `manage/${id}`, { action: "rotate-code" }));
  return db.studyGroup.findUniqueOrThrow({ where: { id } });
}

async function open(id: string) {
  const f = fixture;
  await ok(
    await post(f.head.id, `manage/${id}`, {
      action: "open-subject",
      subjectId: f.own.subject.id,
    }),
  );
}

async function prepareTeacher() {
  const f = fixture;
  await db.roleAssignment.create({
    data: {
      userId: f.author.id,
      role: "AUTHOR",
      departmentId: f.a.id,
      scopeKey: "department:" + f.a.id,
      assignedById: f.head.id,
    },
  });
}

async function assign(id: string) {
  const f = fixture;
  return post(f.head.id, `manage/${id}`, {
    action: "assign-teacher",
    teacherId: f.author.id,
    subjectId: f.own.subject.id,
  });
}

async function application(code: string) {
  return {
    code,
    firstName: "Астра",
    lastName: "Учебная",
    accepted: true,
    noticeVersion: (await currentGroupNotice())!.version,
  };
}

it("grants paid lesson access only after approval and preserves attempts after exclusion", async () => {
  const f = fixture,
    study = await group("101"),
    learner = await f.user("Learner");
  await prepareTeacher();
  expect((await assign(study.id)).status).toBe(404);
  await open(study.id);
  await ok(await assign(study.id));
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: f.author.id } })).role,
  ).toBe("EDITOR");
  const input = await application(study.joinCode!);
  const actor = { userId: learner.id };
  expect(await ok(await post(learner.id, "join", input))).toEqual({
    status: "PENDING",
  });
  expect((await loadLesson(f.own.paid.id, actor)).locked).toBe(true);
  expect(
    (await staffGroup(f.author.id, study.id, "")).members[0],
  ).toMatchObject({
    userId: learner.id,
    status: "PENDING",
    user: { firstName: "Астра", lastName: "Учебная", email: learner.email },
  });
  expect((await staffGroup(f.head.id, study.id, "")).members).toEqual([]);
  const command = { action: "decide", userId: learner.id };
  await ok(
    await post(f.author.id, `manage/${study.id}`, {
      ...command,
      status: "ACTIVE",
    }),
  );
  const lesson = await loadLesson(f.own.paid.id, actor);
  expect(lesson.locked).toBe(false);
  expect((await loadLesson(f.other.paid.id, actor)).locked).toBe(true);
  expect(await db.subscription.count({ where: actor })).toBe(0);
  expect(await db.accessGrant.count({ where: actor })).toBe(0);
  expect(
    await db.groupMember.findUniqueOrThrow({
      where: { groupId_userId: { groupId: study.id, ...actor } },
    }),
  ).toMatchObject({
    noticeVersion: input.noticeVersion,
    noticeAcceptedAt: expect.any(Date),
    decidedById: f.author.id,
  });
  const gap = lesson.gaps[0];
  await answerGap(gap.id, gap.options[0].id, lesson.version, actor);
  await ok(
    await post(f.author.id, `manage/${study.id}`, {
      ...command,
      status: "REMOVED",
    }),
  );
  expect((await loadLesson(f.own.paid.id, actor)).locked).toBe(true);
  expect(await db.gapAnswer.count({ where: actor })).toBe(1);
});

it("separates group scopes and rejects an old, expired or archived code", async () => {
  const f = fixture,
    a = await group("А"),
    b = await group("Б"),
    learner = await f.user("Learner");
  await prepareTeacher();
  await open(a.id);
  await ok(await assign(a.id));
  expect(await can(f.author.id, "group.members", { groupId: a.id })).toBe(true);
  expect(await can(f.author.id, "group.members", { groupId: b.id })).toBe(
    false,
  );
  expect(await can(f.head.id, "group.manage", { groupId: a.id })).toBe(false);
  expect(
    (
      await post(f.head.id, `manage/${b.id}`, {
        action: "open-subject",
        subjectId: f.other.subject.id,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await post(f.admin.id, `manage/${a.id}`, {
        action: "assign-teacher",
        subjectId: f.own.subject.id,
        teacherId: learner.id,
      })
    ).status,
  ).toBe(422);
  await ok(await post(learner.id, "join", await application(b.joinCode!)));
  expect(
    (
      await post(f.author.id, `manage/${b.id}`, {
        action: "decide",
        status: "ACTIVE",
        userId: learner.id,
      })
    ).status,
  ).toBe(404);
  expect(
    (await groupDirectory(f.author.id)).groups.map((row) => row.id),
  ).toEqual([a.id]);
  await expect(staffGroup(f.author.id, b.id, "")).rejects.toMatchObject({
    status: 404,
  });

  await db.roleAssignment.deleteMany({ where: { userId: f.author.id } });
  await expect(staffGroup(f.author.id, a.id, "")).rejects.toMatchObject({
    status: 404,
  });
  await ok(await post(f.admin.id, `manage/${a.id}`, { action: "rotate-code" }));
  const current = await db.studyGroup.findUniqueOrThrow({
    where: { id: a.id },
  });
  expect(current.joinCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  expect(current.joinCode).not.toBe(a.joinCode);
  expect(current.joinCodeExpiresAt!.getTime() - Date.now()).toBeGreaterThan(
    29 * 86400000,
  );
  expect(
    await ok(
      await post(learner.id, "join", await application(a.joinCode!)),
      422,
    ),
  ).toMatchObject({ error: "Код недействителен." });
  await db.studyGroup.update({
    where: { id: a.id },
    data: { joinCodeExpiresAt: new Date(0) },
  });
  expect(
    await ok(
      await post(learner.id, "join", await application(current.joinCode!)),
      422,
    ),
  ).toMatchObject({ error: "Код недействителен." });
  await ok(await post(f.admin.id, `manage/${b.id}`, { action: "archive" }));
  expect(
    await ok(
      await post(learner.id, "join", await application(b.joinCode!)),
      422,
    ),
  ).toMatchObject({ error: "Код недействителен." });
});

it("enforces independent user and IP limits at ten attempts per minute", async () => {
  const f = fixture,
    first = await f.user("First"),
    second = await f.user("Second"),
    third = await f.user("Third");
  vi.spyOn(Date, "now").mockReturnValue(
    Math.floor(Date.now() / 60000) * 60000 + 5000,
  );
  const input = await application("23456789");
  for (let i = 0; i < 10; i++) {
    expect((await post(first.id, "join", input)).status).toBe(422);
  }
  expect((await post(first.id, "join", input, "192.0.2.14")).status).toBe(429);
  expect((await post(second.id, "join", input)).status).toBe(429);
  expect((await post(third.id, "join", input, "192.0.2.15")).status).toBe(422);
});

it("handles multiple enrollments, self-withdrawal, archive, and bulk decisions", async () => {
  const f = fixture,
    a = await group("Авто", false),
    b = await group("Заявки"),
    learner = await f.user("Learner"),
    another = await f.user("Another");
  await open(a.id);
  await open(b.id);
  const actor = { userId: learner.id };
  const postB = await application(b.joinCode!);
  const postA = await application(a.joinCode!);
  expect(
    (await post(learner.id, "join", { ...postA, noticeVersion: "устарела" }))
      .status,
  ).toBe(409);
  expect(
    (await post(learner.id, "join", { ...postA, accepted: false })).status,
  ).toBe(422);
  expect(await ok(await post(learner.id, "join", postA))).toEqual({
    status: "ACTIVE",
  });
  await ok(await post(learner.id, "join", postB));
  await ok(await post(another.id, "join", postB));
  expect(
    await ok(
      await post(f.admin.id, `manage/${b.id}`, {
        action: "decide",
        status: "ACTIVE",
      }),
    ),
  ).toEqual({ updated: 2 });
  await ok(await post(learner.id, `leave/${a.id}`, {}));
  expect((await loadLesson(f.own.paid.id, actor)).locked).toBe(false);
  await ok(await post(f.admin.id, `manage/${b.id}`, { action: "archive" }));
  expect((await loadLesson(f.own.paid.id, actor)).locked).toBe(true);
  expect(
    await db.groupMember.count({ where: { groupId: b.id, status: "ACTIVE" } }),
  ).toBe(2);
});

it("lets faculty admins import within their faculty and reports persisted duplicates by row", async () => {
  const f = fixture;
  await db.user.update({
    where: { id: f.reviewer.id },
    data: { role: "EDITOR" },
  });
  await db.roleAssignment.create({
    data: {
      role: "FACULTY_ADMIN",
      facultyId: f.faculty.id,
      userId: f.reviewer.id,
      scopeKey: "faculty:" + f.faculty.id,
    },
  });
  const input = {
    csv: "name;course;academicYear\n101;1;2026/2027\n\n102;9;2026/2027\n101;1;2026/2027",
    facultyId: f.faculty.id,
  };
  const result = await ok(await post(f.reviewer.id, "import", input));
  expect(result).toMatchObject({
    created: 1,
    duplicates: 1,
    errors: [{ line: 4 }],
  });
  expect(await ok(await post(f.reviewer.id, "import", input))).toMatchObject({
    created: 0,
    duplicates: 2,
  });
  expect(
    (
      await post(f.reviewer.id, "import", {
        ...input,
        facultyId: "org-stomatology",
      })
    ).status,
  ).toBe(404);
});
