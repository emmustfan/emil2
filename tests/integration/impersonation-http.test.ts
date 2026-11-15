import { beforeAll, afterAll, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { openSync, closeSync, mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db";
import { recordInitialTopicRevision } from "../../lib/content/drafts";
import { shuffledOptions } from "../../lib/lessons/public";
import {
  createImpersonationFixture,
  snapshotImpersonationData,
  type ImpersonationFixture,
} from "../helpers/impersonation-fixture";
import {
  apiRouteInventory,
  serverPageInventory,
} from "../helpers/route-inventory";
let child: ChildProcess, f: ImpersonationFixture, origin: string;
const db = getDb();
beforeAll(async () => {
  f = await createImpersonationFixture();
  await recordInitialTopicRevision(db, f.f.free.id);
  const port = await new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
  origin = `http://127.0.0.1:${port}`;
  mkdirSync("tmp", { recursive: true });
  const fd = openSync(`tmp/impersonation-http-${randomUUID()}.log`, "w", 0o600);
  child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: {
        ...process.env,
        NODE_ENV: "development",
        APP_URL: origin,
        LLM_PROVIDER: "mock",
        PAYMENTS_PROVIDER: "mock",
        MAIL_TRANSPORT: "log",
        STORAGE_DRIVER: "local",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );
  closeSync(fd);
  const started = Date.now();
  while (Date.now() - started < 120000) {
    if (child.exitCode !== null)
      throw new Error(
        "HTTP fixture server exited; see tmp/impersonation-http-*.log",
      );
    try {
      if ((await fetch(origin + "/api/health")).ok) return;
    } catch {
      /* The local server is still starting. */
    }
    await delay(250);
  }
  throw new Error(
    "HTTP fixture server did not start; see tmp/impersonation-http-*.log",
  );
}, 130000);
afterAll(async () => {
  if (child?.pid && child.exitCode === null) {
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    process.kill(-child.pid, "SIGTERM");
    await Promise.race([exited, delay(10000)]);
    if (child.exitCode === null) process.kill(-child.pid, "SIGKILL");
  }
  if (f) await f.cleanup();
  await db.$disconnect();
}, 30000);
async function request(
  path: string,
  cookie: string,
  method = "GET",
  data?: unknown,
) {
  return fetch(origin + path, {
    method,
    headers: {
      cookie,
      origin,
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    redirect: "manual",
  });
}
async function post(path: string, cookie: string, data: unknown) {
  const response = await request(path, cookie, "POST", data);
  const body = await response.json();
  expect(response.status, `${path}: ${JSON.stringify(body)}`).toBe(200);
  return { response, body };
}
function pathFor(pattern: string) {
  let path = pattern
    .replace("[...path]", "subjects")
    .replace("[subject]", f.f.subject.slug)
    .replace("[topic]", f.f.free.slug)
    .replace("[slug]", f.f.subject.slug)
    .replace("[kind]", "privacy")
    .replace("[topicId]", f.f.free.id)
    .replace("[paymentId]", f.payment.id)
    .replace("[userId]", f.student.id)
    .replace("[gapId]", f.f.free.gap_topicId[0].id)
    .replace("[cardId]", "fixture-card")
    .replace("[messageId]", f.expiredMessage.id)
    .replace("[subscriptionId]", "fixture-subscription");
  const id = pattern.includes("/subjects/")
    ? f.f.subject.id
    : pattern.includes("/users/")
      ? f.student.id
      : pattern.includes("content-images")
        ? "00000000-0000-4000-8000-000000000001"
        : f.f.free.id;
  path = path.replace("[id]", id);
  if (path === "/checkout/return") path += `?paymentId=${f.payment.id}`;
  return path;
}
it("blocks every discovered write route and preserves complete snapshots while traversing every server page and GET route as student and teacher", async () => {
  const learnerCookie = `sid=${f.studentSid}`;
  const gap = f.f.free.gap_topicId.find((g) => g.order === 0)!,
    wrong = shuffledOptions(
      [gap.answer, ...gap.distractors],
      `user:${f.student.id}`,
      gap.id,
    ).find((o) => o.text !== gap.answer)!;
  await post(`/api/gaps/${gap.id}/answer`, learnerCookie, {
    version: 1,
    optionId: wrong.id,
  });
  const run = (
    await post(`/api/tests/${f.f.free.id}/start`, learnerCookie, { version: 1 })
  ).body;
  await post(`/api/tests/${f.f.free.id}/answer`, learnerCookie, {
    runId: run.runId,
    questionId: run.questions[0].id,
    chosenId: "a",
  });
  const card = await db.card.findFirstOrThrow({
    where: { userId: f.student.id, gapId: gap.id },
  });
  const reveal = (
    await post(`/api/review/${card.id}`, learnerCookie, {
      action: "reveal",
      revision: card.revision,
      topicVersion: 1,
    })
  ).body;
  await post(`/api/review/${card.id}`, learnerCookie, {
    action: "rate",
    revision: reveal.revision,
    topicVersion: 1,
    rating: "HARD",
  });
  const routes = apiRouteInventory(),
    pages = serverPageInventory();
  const revision = await db.topicRevision.findFirstOrThrow({
    where: { topicId: f.f.free.id },
  });
  expect(routes.length).toBeGreaterThan(30);
  expect(pages.length).toBeGreaterThan(30);
  let writeChecks = 0,
    getChecks = 0,
    pageChecks = 0;
  for (const target of [f.student, f.teacher]) {
    const { response } = await post(
      "/api/admin/impersonation",
      `sid=${f.adminSid}`,
      {
        targetUserId: target.id,
        reason: "Проверка всех маршрутов и отсутствия записи",
      },
    );
    const cookieHeader = response.headers.get("set-cookie")!;
    expect(cookieHeader).toMatch(/HttpOnly/i);
    expect(cookieHeader).toMatch(/SameSite=strict/i);
    expect(cookieHeader).not.toMatch(/(?:^|, )sid=/);
    const token = /impersonation=([^;]+)/.exec(cookieHeader)![1],
      cookie = `sid=${f.adminSid}; impersonation=${token}`;
    const before = await snapshotImpersonationData();
    for (const route of routes)
      for (const method of route.methods.filter(
        (m) => !["GET", "HEAD", "OPTIONS"].includes(m),
      )) {
        if (
          method === "POST" &&
          route.pattern === "/api/admin/impersonation/stop"
        )
          continue;
        const response = await request(pathFor(route.pattern), cookie, method, {
          sentinel: "BODY_MUST_NOT_BE_LOGGED",
        });
        expect(
          response.status,
          `${target.role} ${method} ${route.pattern}`,
        ).toBe(403);
        expect((await response.json()).error).toContain("Режим просмотра");
        writeChecks++;
      }
    for (const route of routes.filter((r) => r.methods.includes("GET"))) {
      const response = await request(pathFor(route.pattern), cookie);
      expect(
        response.status,
        `${target.role} GET ${route.pattern}`,
      ).toBeLessThan(500);
      if (
        route.pattern === "/api/admin/progress" ||
        route.pattern.endsWith("/progress")
      )
        expect(response.status).toBe(404);
      if (
        route.pattern.startsWith("/api/admin/users") &&
        !route.pattern.endsWith("/progress")
      )
        expect(response.status).toBe(403);
      if (
        route.pattern === "/api/checkout/[paymentId]" &&
        target.id === f.student.id
      )
        expect(response.status).toBe(200);
      await response.text();
      getChecks++;
    }
    for (const page of pages) {
      // The teacher has no payment of their own; the user's payment URL is intentionally not their page.
      if (
        target.role === "EDITOR" &&
        (page === "/dev/mock-pay/[paymentId]" || page === "/checkout/return")
      )
        continue;
      const response = await request(pathFor(page), cookie);
      expect(response.status, `${target.role} PAGE ${page}`).toBeLessThan(500);
      const html = await response.text();
      if (page === "/cabinet" && target.role === "USER")
        expect(html).toContain(f.student.name);
      if (page === "/teacher" && target.role === "EDITOR")
        expect(response.status).toBe(200);
      if (page === "/learn/[subject]/[topic]") {
        expect(response.status).toBe(200);
        expect(html).toContain("Вы смотрите как");
        expect(html.includes("ОБЪЯСНЕНИЕ_ПОСЛЕ_ОТВЕТА_2")).toBe(false);
      }
      pageChecks++;
    }
    for (const path of [
      `/api/admin/content/subjects/${f.f.subject.id}`,
      `/api/admin/content/topics/${f.f.free.id}`,
      `/api/admin/content/topics/${f.f.free.id}/revisions`,
      `/api/admin/content/topics?subjectId=${f.f.subject.id}`,
      `/api/admin/content/sections?subjectId=${f.f.subject.id}`,
      `/api/admin/content/questions/${f.f.free.question_topicId[0].id}`,
      `/api/admin/content/sections/${f.f.free.sectionId}`,
      `/api/admin/content/revisions/${revision.id}`,
    ]) {
      const result = await request(path, cookie);
      expect(result.status).toBe(target.role === "EDITOR" ? 200 : 403);
      await result.text();
      getChecks++;
    }
    expect(await snapshotImpersonationData()).toEqual(before);
    const stop = await request(
      "/api/admin/impersonation/stop",
      cookie,
      "POST",
      {},
    );
    expect(stop.status).toBe(303);
    expect(stop.headers.get("location")).toBe(
      `${origin}/admin/users/${target.id}`,
    );
    const restored = await request(
      `/admin/users/${target.id}`,
      `sid=${f.adminSid}`,
    );
    expect(restored.status).toBe(200);
    expect(await restored.text()).toContain("Просмотры администратором");
    expect(await snapshotImpersonationData()).toEqual(before);
  }
  const blocked = await db.securityAudit.findMany({
    where: { actorId: f.admin.id, action: "IMPERSONATION_WRITE_BLOCKED" },
  });
  expect(blocked.length).toBeGreaterThan(0);
  expect(JSON.stringify(blocked)).not.toContain("BODY_MUST_NOT_BE_LOGGED");
  expect(
    await db.studentDataAccess.count({
      where: { viewerId: f.admin.id, view: "impersonation" },
    }),
  ).toBe(1);
  console.log(
    JSON.stringify({
      impersonationHttpAudit: {
        writeChecks,
        getChecks,
        pageChecks,
        protectedTables: 20,
      },
    }),
  );
  writeFileSync(
    "tmp/stage12b-http-audit.json",
    JSON.stringify(
      {
        writeChecks,
        getChecks,
        pageChecks,
        protectedTables: Object.keys(await snapshotImpersonationData()),
        routes,
        pages,
      },
      null,
      2,
    ),
  );
}, 360000);

it("can inspect blocked students and assigned teachers without changing their blocked status or data", async () => {
  for (const target of [f.student, f.teacher]) {
    await db.user.update({
      where: { id: target.id },
      data: { blockedAt: new Date() },
    });
    const ordinary = await request(
      "/cabinet/profile",
      `sid=${target.id === f.student.id ? f.studentSid : f.teacherSid}`,
    );
    expect(ordinary.status).toBe(307);
    try {
      const { response } = await post(
        "/api/admin/impersonation",
        `sid=${f.adminSid}`,
        {
          targetUserId: target.id,
          reason: "Проверка обращения заблокированного пользователя",
        },
      );
      const token = /impersonation=([^;]+)/.exec(
          response.headers.get("set-cookie")!,
        )![1],
        cookie = `sid=${f.adminSid}; impersonation=${token}`;
      const before = await snapshotImpersonationData();
      const paths = [
        "/cabinet/profile",
        "/review",
        "/api/review/queue",
        "/api/tutor/quota",
        `/learn/${f.f.subject.slug}/free`,
        ...(target.role === "EDITOR"
          ? [
              "/teacher",
              `/admin/topics/${f.f.free.id}`,
              `/api/admin/content/topics/${f.f.free.id}`,
            ]
          : ["/cabinet"]),
      ];
      for (const path of paths) {
        const page = await request(path, cookie);
        expect(page.status, `${target.role} blocked ${path}`).toBe(200);
        await page.text();
      }
      expect(await snapshotImpersonationData()).toEqual(before);
      expect(
        (await request("/api/admin/impersonation/stop", cookie, "POST", {}))
          .status,
      ).toBe(303);
    } finally {
      await db.user.update({
        where: { id: target.id },
        data: { blockedAt: null },
      });
    }
  }
}, 120000);

it("rejects non-administrator HTTP starts and returns 422 for a missing reason without creating a mode", async () => {
  const before = await db.impersonationSession.count({
    where: { adminId: f.admin.id },
  });
  for (const sid of ["", f.studentSid, f.teacherSid]) {
    const response = await request(
      "/api/admin/impersonation",
      sid ? `sid=${sid}` : "",
      "POST",
      { targetUserId: f.student.id, reason: "Проверка прав доступа" },
    );
    expect(response.status).toBe(403);
  }
  const missing = await request(
    "/api/admin/impersonation",
    `sid=${f.adminSid}`,
    "POST",
    { targetUserId: f.student.id },
  );
  expect(missing.status).toBe(422);
  expect(
    await db.impersonationSession.count({ where: { adminId: f.admin.id } }),
  ).toBe(before);
});
