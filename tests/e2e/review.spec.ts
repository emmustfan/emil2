import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db";
import { newToken, hashToken } from "../../lib/auth/crypto";
import { currentLegal } from "../../lib/auth/legal";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
import type { ReviewQueue, ReviewBack } from "../../lib/srs/types";
const db = getDb(),
  origin = "http://localhost:3100";
let f: LessonFixture, userId: string;
test.setTimeout(90000);
test.beforeEach(async ({ context }) => {
  f = await createLessonFixture("review-browser");
  const legal = await currentLegal();
  const u = await db.user.create({
    data: {
      email: `review-${randomUUID()}@example.test`,
      name: "Студент фикстуры",
      timezone: "Asia/Yekaterinburg",
      consentPdAt: new Date(),
      consentPdVersion: legal.consent.version,
      offerVersion: legal.offer.version,
    },
  });
  userId = u.id;
  const token = newToken();
  await db.session.create({
    data: {
      userId,
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
});
test.afterEach(async ({ context }) => {
  for (const page of context.pages()) await page.close();
  await cleanupLessonFixture(f, [], [userId]);
});
test.afterAll(async () => {
  await db.$disconnect();
});
test("two lesson mistakes become review cards; keyboard ratings persist and update the header", async ({
  page,
}, info) => {
  await page.goto(`/learn/${f.subject.slug}/free`);
  for (let i = 1; i <= 2; i++) {
    const form = page.locator("form").filter({
      has: page.getByRole("group", { name: `Пропуск ${i}`, exact: true }),
    });
    await form
      .getByRole("radio", {
        name: i === 1 ? "неверный-один" : "верный-два",
        exact: true,
      })
      .check();
    await form.getByRole("button", { name: "Проверить", exact: true }).click();
    await expect(form.getByRole("status")).toContainText(
      i === 1 ? "Неверно" : "Верно",
    );
  }
  await expect(
    page.getByRole("link", { name: "К повторению: 1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Начать тест", exact: true }).click();
  for (let i = 1; i <= 5; i++) {
    const form = page.locator("form").filter({
      has: page.getByRole("group", {
        name: new RegExp(`Вопрос ${i}: какой вариант выбрать`),
      }),
    });
    await form
      .getByRole("radio", {
        name: i === 1 ? "Вариант А" : "Вариант Б",
        exact: true,
      })
      .check();
    await form.getByRole("button", { name: "Проверить", exact: true }).click();
    await expect(
      form.getByText(`ОБЪЯСНЕНИЕ_ПОСЛЕ_ОТВЕТА_${i}`, { exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByText("Карточек этой темы в повторении: 3.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "К повторению: 2", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Перейти к повторению", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Повторение", exact: true }),
  ).toBeVisible();
  const html = await (await page.request.get("/review")).text();
  for (const secret of [
    "верный-один",
    "Вариант Б",
    "ОБЪЯСНЕНИЕ_ПОСЛЕ_ОТВЕТА_1",
    "correctOptionIds",
  ])
    expect(html).not.toContain(secret);
  await mkdir("tmp/screenshots", { recursive: true });
  await page.screenshot({
    path: `tmp/screenshots/review-front-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("heading", { name: "Повторение", exact: true }).click();
  await page.keyboard.press("Space");
  await expect(
    page.getByLabel("Ответ карточки", { exact: true }),
  ).toContainText("верный-один");
  await expect(
    page.getByRole("button", { name: "Сложно 10 мин", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Норм 1 дн", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Легко 3 дн", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Новых карточек показано сегодня: 1 \/ 30/),
  ).toBeVisible();
  await page.screenshot({
    path: `tmp/screenshots/review-answer-${info.project.name}.png`,
    fullPage: true,
  });
  await page.keyboard.press("1");
  await expect(
    page.getByRole("button", { name: "Показать ответ", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "К повторению: 1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Показать ответ", exact: true })
    .click();
  await expect(
    page.getByLabel("Ответ карточки", { exact: true }),
  ).toContainText("Вариант Б");
  await page.keyboard.press("3");
  await expect(
    page.getByRole("heading", { name: "На сегодня всё", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Сегодня вы повторили карточек: 2.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "К повторению: 0", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Сегодня вы повторили карточек: 2.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Следующие карточки:/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `tmp/screenshots/review-done-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await db.reviewLog.count({ where: { card: { userId } } })).toBe(2);
  await page.goto("/cabinet");
  await expect(
    page.getByRole("link", { name: "К повторению: 0", exact: true }),
  ).toBeVisible();
});
test("review API requires login, origin, ownership, reveal and a current revision", async ({
  page,
  browser,
}) => {
  await page.goto(`/learn/${f.subject.slug}/free`);
  const form = page.locator("form").filter({
    has: page.getByRole("group", { name: "Пропуск 1", exact: true }),
  });
  await form.getByRole("radio", { name: "неверный-один", exact: true }).check();
  await form.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Неверно");
  const queueResponse = await page.request.get("/api/review/queue");
  expect(queueResponse.headers()["cache-control"]).toContain("no-store");
  const queue: ReviewQueue = await queueResponse.json(),
    card = queue.cards[0];
  const url = `/api/review/${card.id}`,
    reveal = { action: "reveal", revision: 0, topicVersion: 1 },
    grade = { action: "rate", revision: 0, topicVersion: 1, rating: "GOOD" };
  expect(
    (
      await page.request.post(url, {
        headers: { Origin: "https://foreign.example" },
        data: reveal,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post(url, { headers: { Origin: origin }, data: grade })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post(`/api/review/not-owned`, {
        headers: { Origin: origin },
        data: reveal,
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.post(url, {
        headers: { Origin: origin },
        data: { ...reveal, topicVersion: 2 },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post(url, {
        headers: { Origin: origin },
        data: { ...grade, dueAt: "2030-01-01" },
      })
    ).status(),
  ).toBe(422);
  const guest = await browser.newContext({ baseURL: origin });
  try {
    expect((await guest.request.get("/api/review/queue")).status()).toBe(401);
    expect(
      (
        await guest.request.post(url, {
          headers: { Origin: origin },
          data: reveal,
        })
      ).status(),
    ).toBe(401);
    const p = await guest.newPage();
    await p.goto("/review");
    await expect(p).toHaveURL(/\/login/);
  } finally {
    await guest.close();
  }
  const shown = await page.request.post(url, {
    headers: { Origin: origin },
    data: reveal,
  });
  const back: ReviewBack = await shown.json();
  expect(back.answers).toEqual(["верный-один"]);
  for (let i = 0; i < 2; i++)
    expect(
      (
        await page.request.post(url, {
          headers: { Origin: origin },
          data: grade,
        })
      ).status(),
    ).toBe(200);
  expect(await db.reviewLog.count({ where: { cardId: card.id } })).toBe(1);
  expect(
    (
      await page.request.post(url, {
        headers: { Origin: origin },
        data: { ...grade, rating: "EASY" },
      })
    ).status(),
  ).toBe(409);
});
test("a new learner sees an empty review queue with a path back to lessons", async ({
  page,
}) => {
  await page.goto("/review");
  await expect(
    page.getByRole("heading", { name: "Пока нет карточек", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Продолжить учиться", exact: true })
    .click();
  await expect(page).toHaveURL(/\/subjects$/);
});
