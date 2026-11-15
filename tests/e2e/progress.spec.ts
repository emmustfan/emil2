import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db";
import { currentLegal } from "../../lib/auth/legal";
import { newToken, hashToken } from "../../lib/auth/crypto";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
import { shuffledOptions } from "../../lib/lessons/public";
import { studentProfiles } from "../../scripts/preview/student-profiles";
const db = getDb(),
  users: string[] = [],
  contexts: BrowserContext[] = [];
let f: LessonFixture,
  admin: string,
  teacher: string,
  student: string,
  other: string,
  studentName: string;
test.setTimeout(90000);
async function user(role: "ADMIN" | "EDITOR" | "USER", name: string) {
  const legal = await currentLegal();
  const u = await db.user.create({
    data: {
      role,
      name,
      email: `progress-browser-${randomUUID()}@example.test`,
      university: "Учебный стенд",
      course: 1,
      createdAt: new Date(Date.now() - 30 * 86400000),
      emailVerifiedAt: new Date(),
      consentPdAt: new Date(),
      consentPdVersion: legal.consent.version,
      offerVersion: legal.offer.version,
    },
  });
  users.push(u.id);
  return u.id;
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
test.beforeEach(async ({ context, browser }) => {
  f = await createLessonFixture("progress-browser");
  studentName = studentProfiles(42)[6].name;
  admin = await user("ADMIN", "Администратор проверки");
  teacher = await user("EDITOR", "Учитель проверки");
  student = await user("USER", studentName);
  other = await user("USER", "Другой ученик проверки");
  const learner = await browser.newContext({
    baseURL: "http://localhost:3100",
  });
  contexts.push(learner);
  await signIn(learner, student);
  async function post(path: string, data: unknown) {
    const response = await learner.request.post(path, {
      headers: { Origin: "http://localhost:3100" },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const gap = f.free.gap_topicId.find((g) => g.order === 0)!,
    options = shuffledOptions(
      [gap.answer, ...gap.distractors],
      `user:${student}`,
      gap.id,
    ),
    wrong = options.find((o) => o.text !== gap.answer)!.id;
  await post(`/api/gaps/${gap.id}/answer`, { optionId: wrong, version: 1 });
  await post(`/api/gaps/${gap.id}/answer`, {
    optionId: wrong,
    version: 1,
    practice: true,
  });
  await post(`/api/gaps/${gap.id}/answer`, {
    optionId: options.find((o) => o.text === gap.answer)!.id,
    version: 1,
    practice: true,
  });
  const run = await post(`/api/tests/${f.free.id}/start`, { version: 1 });
  for (const q of run.questions)
    await post(`/api/tests/${f.free.id}/answer`, {
      runId: run.runId,
      questionId: q.id,
      chosenId: "a",
    });
  const second = await browser.newContext({ baseURL: "http://localhost:3100" });
  contexts.push(second);
  await signIn(second, other);
  expect(
    (
      await second.request.post(`/api/gaps/${gap.id}/answer`, {
        headers: { Origin: "http://localhost:3100" },
        data: {
          optionId: shuffledOptions(
            [gap.answer, ...gap.distractors],
            `user:${other}`,
            gap.id,
          )[0].id,
          version: 1,
        },
      })
    ).status(),
  ).toBe(200);
  await signIn(context, admin);
});
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
  await cleanupLessonFixture(f, [], users.splice(0));
});
test.afterAll(async () => {
  await db.$disconnect();
});
test("administrator opens lagging demo learner, sees first and all practice answers and correct keys, with audited subject filtering", async ({
  page,
}, info) => {
  await page.goto("/admin");
  if (info.project.name === "mobile")
    await page
      .getByRole("button", { name: "Открыть меню", exact: true })
      .click();
  await page
    .getByRole("link", { name: "Прогресс студентов", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Имя или email студента", exact: true })
    .fill(studentName);
  await page
    .getByRole("combobox", { name: "Фильтр прогресса", exact: true })
    .selectOption("lagging");
  await page.getByRole("button", { name: "Показать", exact: true }).click();
  await expect(
    page.getByRole("link", { name: studentName, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: studentName, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/users/${student}/progress$`));
  await expect(
    page.getByRole("heading", { name: studentName, exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("a[href='/admin/progress'][aria-current='page']"),
  ).toHaveCount(1);
  const topic = page
    .locator("details")
    .filter({
      has: page.locator("summary", {
        hasText: `${f.subject.title} · ${f.free.title}`,
      }),
    })
    .first();
  const gap = topic
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Пропуск 1:" }) })
    .first();
  await gap.locator("summary").click();
  await expect(gap).toContainText("Первый ответ: неверный-один · Неверно");
  await expect(gap).toContainText("Правильный ответ: верный-один");
  await expect(gap).toContainText("Все попытки (3)");
  await expect(gap).toContainText("Практика");
  await expect(
    page.getByRole("heading", {
      name: "Самооценка студента за 30 дней",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Содержимое переписки не показывается.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: `tmp/screenshots/progress-student-${info.project.name}.png`,
    fullPage: true,
  });
  const before = await db.studentDataAccess.count({
    where: { studentId: student },
  });
  await page
    .getByRole("combobox", { name: "Предмет прогресса", exact: true })
    .selectOption(f.subject.id);
  await page.getByRole("button", { name: "Показать", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`subjectId=${f.subject.id}`));
  await expect
    .poll(() => db.studentDataAccess.count({ where: { studentId: student } }))
    .toBeGreaterThan(before);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("admin progress pages and APIs return 404 for guests, teachers and students, including own-id routes", async ({
  browser,
}) => {
  for (const id of [null, teacher, student]) {
    const context = await browser.newContext({
      baseURL: "http://localhost:3100",
    });
    contexts.push(context);
    if (id) await signIn(context, id);
    for (const path of [
      "/admin/progress",
      `/admin/users/${id ?? student}/progress`,
      "/api/admin/progress",
      `/api/admin/users/${id ?? student}/progress`,
      `/api/admin/users/${other}/progress`,
    ]) {
      const response = await context.request.get(path);
      expect(response.status(), path).toBe(404);
      expect(await response.text()).not.toContain("верный-один");
    }
  }
});
test("student sees only their own attempt history and cannot select another person's id", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3100",
  });
  contexts.push(context);
  await signIn(context, student);
  const response = await context.request.get(
    `/api/lessons/${f.free.id}/history?userId=${other}`,
  );
  expect(response.status()).toBe(200);
  const rows = await response.json();
  expect(rows).toHaveLength(3);
  expect(
    rows.filter((row: { practice: boolean }) => row.practice),
  ).toHaveLength(2);
  expect(JSON.stringify(rows)).not.toContain("correctValues");
  expect(JSON.stringify(rows)).not.toContain("correctOptionIds");
  const page = await context.newPage();
  await page.goto(`/learn/${f.subject.slug}/${f.free.slug}`);
  await page.getByText("История ответов", { exact: true }).click();
  const history = page
    .locator("details")
    .filter({ hasText: "Все ваши ответы на пропуски" });
  await expect(history.getByRole("listitem")).toHaveCount(3);
  await expect(history).toContainText("Практика");
  const guest = await browser.newContext({ baseURL: "http://localhost:3100" });
  contexts.push(guest);
  expect(
    (await guest.request.get(`/api/lessons/${f.free.id}/history`)).status(),
  ).toBe(404);
});
