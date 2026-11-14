import { test, expect, type BrowserContext } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { getDb } from "../../lib/db";
import { getEnv } from "../../lib/env";
import { currentLegal } from "../../lib/auth/legal";
import { newToken, hashToken } from "../../lib/auth/crypto";
import { createStorageDriver } from "../../lib/storage";
import { deleteTopic } from "../../lib/content/service";
import {
  getContentQueue,
  closeContentQueue,
  CONTENT_IMPORT_QUEUE,
} from "../../lib/content/jobs";
import { sourcePdf, sourceDocx } from "../helpers/import-fixture";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
const db = getDb(),
  users: string[] = [];
let f: LessonFixture, admin: string, teacher: string, worker: ChildProcess;
test.setTimeout(90000);
test.use({ timezoneId: "Asia/Yekaterinburg" });
async function user(role: "ADMIN" | "EDITOR" | "USER") {
  const docs = await currentLegal(),
    row = await db.user.create({
      data: {
        email: `imports-browser-${randomUUID()}@example.test`,
        name: "Проверка импорта",
        role,
        consentPdAt: new Date(),
        consentPdVersion: docs.consent.version,
        offerVersion: docs.offer.version,
      },
    });
  users.push(row.id);
  return row.id;
}
async function signIn(context: BrowserContext, id: string) {
  const token = newToken();
  await db.session.create({
    data: {
      userId: id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await context.addCookies([
    {
      name: "sid",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
test.beforeAll(async () => {
  worker = spawn(process.execPath, ["--import", "tsx", "worker/index.ts"], {
    env: {
      ...process.env,
      LLM_PROVIDER: "mock",
      PAYMENTS_PROVIDER: "mock",
      MAIL_TRANSPORT: "log",
      STORAGE_DRIVER: "local",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(
      () => fail(new Error("Import worker did not start")),
      20000,
    );
    worker.stdout!.on("data", (value) => {
      if (value.toString().includes("worker_ready")) {
        clearTimeout(timer);
        ok();
      }
    });
    worker.once("error", (e) => {
      clearTimeout(timer);
      fail(e);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code) fail(new Error("Import worker exited"));
    });
  });
});
test.beforeEach(async ({ context }) => {
  f = await createLessonFixture("imports-browser");
  admin = await user("ADMIN");
  teacher = await user("EDITOR");
  await db.teacherSubject.create({
    data: { teacherId: teacher, subjectId: f.subject.id, assignedById: admin },
  });
  await signIn(context, teacher);
});
test.afterEach(async () => {
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
      const row = await db.topic.findUnique({ where: { id } });
      if (row) await deleteTopic(id, row.editRevision, admin);
    }
    await createStorageDriver(getEnv()).remove(job.fileKey);
  }
  await db.importJob.deleteMany({ where: { createdById: { in: users } } });
  await db.teacherSubject.deleteMany({
    where: {
      OR: [{ teacherId: { in: users } }, { assignedById: { in: users } }],
    },
  });
  await cleanupLessonFixture(f, [], users.splice(0));
});
test.afterAll(async () => {
  if (worker && !worker.killed) {
    worker.kill("SIGTERM");
    await new Promise<void>((ok) => {
      worker.once("exit", () => ok());
      setTimeout(() => {
        worker.kill("SIGKILL");
        ok();
      }, 12000).unref();
    });
  }
  await closeContentQueue();
  await db.$disconnect();
});
test("teacher uploads a five-page PDF, leaves the page and returns to the generated draft", async ({
  page,
}, info) => {
  await page.goto(`/admin/subjects/${f.subject.id}/topics/new`);
  await page
    .getByRole("tab", { name: "Из файла PDF / DOCX", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Создать уроки из материала",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Раздел", { exact: true })
    .selectOption(f.free.sectionId!);
  await page.getByLabel("Файл PDF, DOCX или TXT").setInputFiles({
    name: "учебный-источник.pdf",
    mimeType: "application/pdf",
    buffer: sourcePdf(),
  });
  await page.getByLabel("У нас есть права на этот материал").check();
  const uploaded = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/imports") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Создать черновики" }).click();
  const response = await uploaded;
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  await page.goto("/teacher");
  await page.goto(`/admin/subjects/${f.subject.id}/topics/new`);
  await page
    .getByRole("tab", { name: "Из файла PDF / DOCX", exact: true })
    .click();
  const job = page.locator(`[data-import-id="${id}"]`);
  await expect(job.getByText("Черновики готовы", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await expect(
    job.getByText("Требуется проверка эксперта.", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mkdir("tmp/screenshots", { recursive: true });
  await page.screenshot({
    path: `tmp/screenshots/imports-${info.project.name}.png`,
    fullPage: true,
  });
  await job.getByRole("link", { name: /Открыть черновик/ }).click();
  await expect(
    page.getByRole("heading", { name: "Готовность к публикации", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Проверено экспертом" }),
  ).not.toBeChecked();
  const row = await db.importJob.findUniqueOrThrow({ where: { id } });
  expect(await db.question.count({ where: { topicId: row.topicIds[0] } })).toBe(
    10,
  );
  await expect(
    page.getByText("Тестовый ИИ", { exact: true }),
  ).not.toBeVisible();
});
test("shows an actionable scan error and imports DOCX through the real worker", async ({
  page,
}) => {
  await page.goto(`/admin/imports?subjectId=${f.subject.id}`);
  await page.getByLabel("Файл PDF, DOCX или TXT").setInputFiles({
    name: "scan.pdf",
    mimeType: "application/pdf",
    buffer: sourcePdf(true),
  });
  await page.getByLabel("У нас есть права на этот материал").check();
  await page.getByRole("button", { name: "Создать черновики" }).click();
  await expect(page.getByText(/Нужен файл с текстом/)).toBeVisible({
    timeout: 45000,
  });
  await page.getByLabel("Файл PDF, DOCX или TXT").setInputFiles({
    name: "source.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: sourceDocx(),
  });
  await page.getByLabel("У нас есть права на этот материал").check();
  await page.getByRole("button", { name: "Создать черновики" }).click();
  await expect(
    page.getByRole("link", { name: /Открыть черновик/ }),
  ).toBeVisible({ timeout: 45000 });
});
test("rejects students and cross-origin uploads at the API", async ({
  page,
  context,
}) => {
  const cross = await page.request.post("/api/admin/imports", {
    headers: { Origin: "https://foreign.example.test" },
    multipart: {
      subjectId: f.subject.id,
      rightsConfirmed: "true",
      text: "fixture",
    },
  });
  expect(cross.status()).toBe(403);
  const student = await user("USER");
  await signIn(context, student);
  expect((await page.request.get("/api/admin/imports")).status()).toBe(403);
  expect((await page.goto("/admin/imports"))?.status()).toBe(403);
});
