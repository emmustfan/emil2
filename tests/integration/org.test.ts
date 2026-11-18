import { afterEach, afterAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getDb } from "../../lib/db";
import { getEnv } from "../../lib/env";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import {
  changeAssignment,
  saveDepartment,
  updateReviewerRule,
} from "../../lib/org/service";
import { assertCan } from "../../lib/org";
import * as content from "../../lib/content/service";
import * as route from "../../app/api/admin/content/[...path]/route";
import { POST as imagePost } from "../../app/api/admin/content/topics/[topicId]/images/route";
import * as imports from "../../app/api/admin/imports/route";
import { GET as importGet } from "../../app/api/admin/imports/[id]/route";
import {
  createOrgFixture,
  readyTopic,
  readyQuestion,
  type OrgFixture,
} from "../helpers/org-fixture";
import type { TopicInput } from "../../lib/content/validation";

const state = vi.hoisted(() => ({ actor: "" }));
vi.mock("../../lib/auth/server", () => ({
  getCurrentSession: async () => {
    const { getDb } = await import("../../lib/db");
    const user = await getDb().user.findUnique({ where: { id: state.actor } });
    return user ? { user, userId: user.id } : null;
  },
}));
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    DEFAULT_SETTINGS[key],
}));
vi.mock("../../lib/content/jobs", () => ({
  getContentQueue: vi.fn(async () => ({})),
  enqueuePublication: vi.fn(async () => {}),
}));

const db = getDb();
let f: OrgFixture;
beforeEach(async () => {
  f = await createOrgFixture();
  state.actor = f.author.id;
});
afterEach(async () => {
  await f.cleanup();
});
afterAll(async () => {
  await db.$disconnect();
});

async function call(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
) {
  const url = new URL("/api/admin/content/" + path, getEnv().APP_URL);
  return route[method](
    new NextRequest(url, {
      method,
      headers: { origin: url.origin, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    {
      params: Promise.resolve({
        path: url.pathname.slice("/api/admin/content/".length).split("/"),
      }),
    },
  );
}
const authorGrant = () => ({
  userId: f.author.id,
  role: "AUTHOR",
  scope: "department",
  scopeId: f.a.id,
});

it("scopes actual content, image and import HTTP handlers across departments of one faculty", async () => {
  await changeAssignment(f.head.id, authorGrant());
  const topic = f.other.free,
    question = topic.question_topicId[0];
  const topicPath = "topics/" + topic.id,
    questionPath = "questions/" + question.id;
  const checks = [
    ["GET", topicPath, undefined],
    ["GET", questionPath, undefined],
    ["GET", `topics?subjectId=${f.other.subject.id}`, undefined],
    [
      "PATCH",
      topicPath,
      {
        ...readyTopic(f.other.subject.id),
        subjectId: undefined,
        revision: topic.editRevision,
      },
    ],
    ["DELETE", topicPath, { revision: topic.editRevision }],
    ["POST", topicPath + "/publish", { revision: topic.editRevision }],
    ["POST", topicPath + "/unpublish", { revision: topic.editRevision }],
    [
      "PATCH",
      questionPath,
      { ...readyQuestion(1), topicRevision: topic.editRevision },
    ],
    ["DELETE", questionPath, { topicRevision: topic.editRevision }],
  ] as const;
  for (const [method, path, body] of checks)
    expect((await call(method, path, body)).status, method + " " + path).toBe(
      404,
    );
  const subjects = await (await call("GET", "subjects")).json();
  expect(subjects.items.map((s: { id: string }) => s.id)).toEqual([
    f.own.subject.id,
  ]);
  const url = new URL("/api/admin/imports", getEnv().APP_URL);
  const form = new FormData();
  form.append("file", new File(["x"], "file.png", { type: "image/png" }));
  expect(
    (
      await imagePost(
        new Request(url, {
          method: "POST",
          headers: { origin: url.origin },
          body: form,
        }),
        { params: Promise.resolve({ topicId: topic.id }) },
      )
    ).status,
  ).toBe(404);
  const privateJob = await db.importJob.create({
    data: {
      subjectId: f.other.subject.id,
      createdById: f.admin.id,
      status: "done",
      fileKey: "fixture",
      topicIds: [topic.id],
    },
  });
  expect(
    (
      await importGet(new Request(url), {
        params: Promise.resolve({ id: privateJob.id }),
      })
    ).status,
  ).toBe(404);
  expect(await (await imports.GET(new Request(url))).json()).toEqual([]);
  const source = new FormData();
  source.set("text", "Учебный текст");
  source.set("subjectId", f.other.subject.id);
  source.set("rightsConfirmed", "true");
  expect(
    (
      await imports.POST(
        new Request(url, {
          method: "POST",
          headers: { origin: url.origin },
          body: source,
        }),
      )
    ).status,
  ).toBe(404);
  expect((await call("GET", "topics/" + f.own.free.id)).status).toBe(200);
  await changeAssignment(f.head.id, authorGrant(), true);
  expect((await call("GET", "topics/" + f.own.free.id)).status).toBe(403);
  const after = await db.user.findUniqueOrThrow({ where: { id: f.author.id } });
  expect(after).toMatchObject({ role: "USER", roleRevision: 2 });
  expect(
    await db.securityAudit.count({
      where: {
        targetId: f.author.id,
        action: { in: ["STAFF_ROLE_ASSIGNED", "STAFF_ROLE_REVOKED"] },
      },
    }),
  ).toBe(2);
});

it("publishes with a separate reviewer and refuses the author or reviewer who last edited", async () => {
  await changeAssignment(f.head.id, authorGrant());
  const reviewGrant = {
    userId: f.reviewer.id,
    role: "REVIEWER",
    scope: "department",
    scopeId: f.a.id,
  };
  await changeAssignment(f.head.id, reviewGrant);
  await updateReviewerRule(f.head.id, f.a.id, {
    requireSeparateReviewer: true,
  });
  const { subjectId, ...fields } = readyTopic(f.own.subject.id);
  let topic = await content.createTopic(subjectId, fields, f.author.id);
  for (let i = 1; i <= 5; i++)
    topic = await content.createQuestion(
      topic.id,
      topic.editRevision,
      readyQuestion(i),
      f.author.id,
    );
  await expect(
    content.publishTopic(topic.id, topic.editRevision, f.author.id),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    content.updateTopic(topic.id, topic.editRevision, fields, f.reviewer.id),
  ).rejects.toMatchObject({ status: 403 });
  await changeAssignment(f.head.id, { ...reviewGrant, role: "AUTHOR" });
  const edited: TopicInput = {
    ...fields,
    contentMd: fields.contentMd + "\n\nПоследняя правка рецензента.",
  };
  topic = await content.updateTopic(
    topic.id,
    topic.editRevision,
    edited,
    f.reviewer.id,
  );
  await expect(
    content.publishTopic(topic.id, topic.editRevision, f.reviewer.id),
  ).rejects.toMatchObject({ status: 403 });
  topic = await content.updateTopic(
    topic.id,
    topic.editRevision,
    { ...edited, title: "Проверенный урок" },
    f.author.id,
  );
  topic = await content.setTopicStatus(
    topic.id,
    topic.editRevision,
    "REVIEW",
    f.author.id,
  );
  const published = await content.publishTopic(
    topic.id,
    topic.editRevision,
    f.reviewer.id,
  );
  expect(published).toMatchObject({ status: "PUBLISHED", version: 1 });
});

it("rejects cross-department or escalating assignments and archives only departments without published subjects", async () => {
  await expect(
    changeAssignment(f.head.id, { ...authorGrant(), scopeId: f.b.id }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    changeAssignment(f.head.id, { ...authorGrant(), role: "DEPARTMENT_HEAD" }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    saveDepartment(f.admin.id, f.a.id, {
      title: f.a.title,
      slug: f.a.slug,
      order: 0,
      facultyId: f.faculty.id,
      archived: true,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    db.roleAssignment.create({
      data: {
        userId: f.author.id,
        role: "REVIEWER",
        scopeKey: "faculty:" + f.faculty.id,
        facultyId: f.faculty.id,
      },
    }),
  ).rejects.toThrow();
  await assertCan(f.head.id, "subject.manage", { subjectId: f.own.subject.id });
});
