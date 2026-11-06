import { expect, test, type BrowserContext } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { getDb } from "../../lib/db";
import { hashToken } from "../../lib/auth/crypto";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
const db = getDb(),
  origin = "http://localhost:3100";
let fixture: LessonFixture | undefined;
const contexts: BrowserContext[] = [];
test.setTimeout(90000);
test.beforeEach(async () => {
  fixture = await createLessonFixture("lesson-browser");
});
test.afterEach(async ({ page, context }) => {
  const demos = new Set<string>();
  for (const browser of [context, ...contexts]) {
    const cookie = (await browser.cookies()).find(
      (c) => c.name === "lesson_guest",
    );
    if (cookie) {
      const rows = await db.demoSession.findMany({
        where: { anonId: hashToken(cookie.value), userId: null },
        select: { id: true },
      });
      rows.forEach((r) => demos.add(r.id));
    }
  }
  await page.close();
  for (const browser of contexts.splice(0)) await browser.close();
  if (fixture) await cleanupLessonFixture(fixture, [...demos]);
  fixture = undefined;
});
test.afterAll(async () => {
  await db.$disconnect();
});
test("guest completes a free lesson from the catalog and resumes after reload", async ({
  page,
  context,
}, testInfo) => {
  const f = fixture!;
  await page.goto("/subjects?course=1");
  await page.getByRole("link", { name: /Учебный стенд/ }).click();
  await expect(
    page.getByRole("heading", { name: "Учебный стенд", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Пропусков: 4", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Начать с бесплатной темы" }).click();
  await expect(page).toHaveURL(new RegExp(`/learn/${f.subject.slug}/free$`));
  await expect(
    page.getByRole("heading", { name: f.free.title, exact: true }),
  ).toBeVisible();
  const html = await (
    await page.request.get(`/learn/${f.subject.slug}/free`)
  ).text();
  for (const secret of [
    "correctOptionIds",
    "correctId",
    "ОБЪЯСНЕНИЕ_ПОСЛЕ_ОТВЕТА",
    "[[верный-один|",
    f.free.gap_topicId[0].gapKey,
  ])
    expect(html).not.toContain(secret);
  const cookie = (await context.cookies()).find(
    (c) => c.name === "lesson_guest",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  await mkdir("tmp/screenshots", { recursive: true });
  await page.screenshot({
    path: `tmp/screenshots/lesson-stage-3-start-${testInfo.project.name}.png`,
    fullPage: true,
  });
  // The first gap works with arrows and Enter; use text to choose the fixture's correct option.
  const first = page
    .getByRole("button", { name: "Заполнить пропуск", exact: true })
    .first();
  await first.focus();
  await first.press("ArrowDown");
  await expect(
    page.getByRole("menu", { name: "Варианты ответа" }),
  ).toBeVisible();
  const texts = await page.getByRole("menuitem").allTextContents();
  const right = texts.indexOf("верный-один");
  expect(right).toBeGreaterThanOrEqual(0);
  if (right) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", {
      name: "Пропуск: верный-один. Верно",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Пропуск: верный-один. Верно",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Пропуски: 1 / 2", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Заполнить пропуск", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "неверный-два", exact: true })
    .click();
  await expect(
    page.getByText("Неверно. Правильно:", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Начать тест", exact: true }).click();
  for (let i = 0; i < 5; i++) {
    const form = page.locator("form").filter({
      has: page.getByRole("group", {
        name: new RegExp(`Вопрос ${i + 1}: какой вариант выбрать`),
      }),
    });
    await form.getByRole("radio", { name: "Вариант Б", exact: true }).check();
    await form.getByRole("button", { name: "Ответить", exact: true }).click();
    await expect(
      form.getByText(`ОБЪЯСНЕНИЕ_ПОСЛЕ_ОТВЕТА_${i + 1}`, { exact: true }),
    ).toBeVisible();
    if (i === 0) {
      await page.reload();
      await expect(
        page.getByText("ОБЪЯСНЕНИЕ_ПОСЛЕ_ОТВЕТА_1", { exact: true }),
      ).toBeVisible();
    }
  }
  await expect(
    page.getByRole("heading", { name: "Тема пройдена!", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Тема пройдена!", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await mkdir("tmp/screenshots", { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: `tmp/screenshots/lesson-stage-3-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const answered = await db.gapAnswer.count({
    where: { gap: { topicId: f.free.id } },
  });
  expect(answered).toBe(2);
  await page
    .getByRole("button", { name: "Пройти заново", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Заполнить пропуск", exact: true }),
  ).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole("button", { name: /Пропуск:/ })).toHaveCount(2);
});
test("paid lesson sends only a safe preview and protects all answer endpoints", async ({
  page,
}) => {
  const f = fixture!;
  const response = await page.goto(`/learn/${f.subject.slug}/paid`);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: /Откройте предмет/ }),
  ).toBeVisible();
  const html = await response!.text();
  for (const secret of [
    "ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ",
    "верный-один",
    "неверный-один",
    "ОБЪЯСНЕНИЕ_ПОСЛЕ_ОТВЕТА",
    f.paid.question_topicId[0].stem,
  ])
    expect(html).not.toContain(secret);
  await expect(
    page.getByRole("button", { name: "Заполнить пропуск" }),
  ).toHaveCount(0);
  for (const [path, data] of [
    [
      `/api/gaps/${f.paid.gap_topicId[0].id}/answer`,
      { optionId: "0".repeat(64), version: 1 },
    ],
    [`/api/tests/${f.paid.id}/start`, { version: 1 }],
    [
      `/api/tests/${f.paid.id}/answer`,
      {
        runId: "forged",
        questionId: f.paid.question_topicId[0].id,
        chosenId: "b",
      },
    ],
  ] as const) {
    const r = await page.request.post(path, {
      data,
      headers: { Origin: origin },
    });
    expect(r.status(), await r.text()).toBe(403);
  }
  const foreign = await page.request.post(`/api/tests/${f.free.id}/start`, {
    data: { version: 1 },
    headers: { Origin: "https://foreign.example" },
  });
  expect(foreign.status()).toBe(403);
  await page
    .getByRole("link", { name: "Посмотреть доступ", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Доступ к материалам", exact: true }),
  ).toBeVisible();
});
test("guest sessions are isolated and unpublished topics cannot be opened", async ({
  page,
  browser,
}) => {
  const f = fixture!;
  await page.goto(`/learn/${f.subject.slug}/free`);
  await page
    .getByRole("button", { name: "Заполнить пропуск", exact: true })
    .first()
    .click();
  await page
    .getByRole("menuitem", { name: "верный-один", exact: true })
    .click();
  await expect(
    page.getByText("Пропуски: 1 / 2", { exact: true }),
  ).toBeVisible();
  const other = await browser.newContext();
  contexts.push(other);
  const fresh = await other.newPage();
  await fresh.goto(`${origin}/learn/${f.subject.slug}/free`);
  await expect(
    fresh.getByRole("button", { name: "Заполнить пропуск", exact: true }),
  ).toHaveCount(2);
  await expect(
    fresh.getByText("Пропуски: 0 / 2", { exact: true }),
  ).toBeVisible();
  await db.topic.update({
    where: { id: f.free.id },
    data: { status: "DRAFT" },
  });
  const r = await page.goto(`/learn/${f.subject.slug}/free`);
  expect(r?.status()).toBe(404);
  await db.subject.update({
    where: { id: f.subject.id },
    data: { status: "DRAFT" },
  });
  const s = await page.goto(`/subjects/${f.subject.slug}`);
  expect(s?.status()).toBe(404);
});
