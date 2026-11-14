import { lessonGap } from "../helpers/inline-gap";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { getDb } from "../../lib/db";
import { newToken, hashToken } from "../../lib/auth/crypto";
import { currentLegal } from "../../lib/auth/legal";
import { indexTopic } from "../../lib/tutor/indexing";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
const db = getDb(),
  origin = "http://localhost:3100";
let f: LessonFixture;
const users: string[] = [];
test.setTimeout(90000);
test.beforeEach(async () => {
  f = await createLessonFixture("tutor-browser");
  for (const topic of [f.free, f.paid])
    await indexTopic({
      topicId: topic.id,
      subjectId: f.subject.id,
      version: 1,
    });
});
test.afterEach(async ({ context }) => {
  const cookie = (await context.cookies()).find(
    (c) => c.name === "lesson_guest",
  );
  const demos = cookie
    ? await db.demoSession.findMany({
        where: { anonId: hashToken(cookie.value), userId: null },
        select: { id: true },
      })
    : [];
  for (const page of context.pages()) await page.close();
  await cleanupLessonFixture(
    f,
    demos.map((d) => d.id),
    users.splice(0),
  );
});
test.afterAll(async () => {
  await db.$disconnect();
});
test("guest receives cited answers, follows a block, blocks personal data and reaches the five-question limit", async ({
  page,
}, info) => {
  await page.goto(`/learn/${f.subject.slug}/free`);
  const launcher = page.getByRole("button", {
    name: "Спросить тьютора",
    exact: true,
  });
  if (await launcher.isVisible()) await launcher.click();
  const panel = page.getByRole("region", { name: "ИИ-тьютор", exact: true });
  await expect(
    panel.getByText("Осталось вопросов: 5", { exact: true }),
  ).toBeVisible();
  const ask = async (text: string, remaining: number) => {
    await panel
      .getByRole("textbox", { name: "Ваш вопрос", exact: true })
      .fill(text);
    await panel
      .getByRole("button", { name: "Задать вопрос", exact: true })
      .click();
    await expect(
      panel.getByText(`Осталось вопросов: ${remaining}`, { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Задать вопрос", exact: true }),
    ).toBeDisabled();
  };
  await ask("Первый выбор", 4);
  const citation = panel.getByRole("link", { name: /Источник 1:/ }).first(),
    href = await citation.getAttribute("href");
  expect(href).toContain(`/learn/${f.subject.slug}/free#b-`);
  await expect(panel.getByText(/ИИ может ошибаться/)).toBeVisible();
  await panel.getByRole("button", { name: "Полезно", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Полезно", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await citation.click();
  await expect(page).toHaveURL(origin + href!);
  await expect(page.locator(":target")).toHaveAttribute(
    "id",
    href!.split("#")[1],
  );
  await ask("Космический двигатель", 3);
  await expect(
    panel.getByRole("article", { name: "Ответ тьютора" }).last(),
  ).toContainText("В материалах платформы этого нет");
  await panel
    .getByRole("textbox", { name: "Ваш вопрос", exact: true })
    .fill("Телефон +7 (999) 123-45-67");
  await panel
    .getByRole("button", { name: "Задать вопрос", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Уберите персональные данные",
  );
  expect(
    (
      await page.request.post("/api/tutor", {
        headers: { Origin: origin },
        data: {
          kind: "question",
          topicId: f.free.id,
          text: "Почта student@example.ru",
          requestId: randomUUID(),
        },
      })
    ).status(),
  ).toBe(422);
  await expect(
    panel.getByText("Осталось вопросов: 3", { exact: true }),
  ).toBeVisible();
  for (let remaining = 2; remaining >= 0; remaining--)
    await ask("Первый выбор", remaining);
  await expect(
    panel.getByRole("textbox", { name: "Ваш вопрос", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("link", { name: "Войти", exact: true }),
  ).toBeVisible();
  const exhausted = await page.request.post("/api/tutor", {
    headers: { Origin: origin },
    data: {
      kind: "question",
      topicId: f.free.id,
      text: "Первый выбор",
      requestId: randomUUID(),
    },
  });
  expect(exhausted.status()).toBe(429);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mkdir("tmp/screenshots", { recursive: true });
  await panel.screenshot({
    path: `tmp/screenshots/tutor-guest-${info.project.name}.png`,
  });
  await page.reload();
  if (await launcher.isVisible()) await launcher.click();
  await expect(
    panel.getByText("Осталось вопросов: 0", { exact: true }),
  ).toBeVisible();
});
test("explain buttons use the saved wrong gap and quiz answer", async ({
  page,
}, info) => {
  await page.goto(`/learn/${f.subject.slug}/free`);
  const gap = lessonGap(page, 1);
  await expect(
    gap.getByRole("button", { name: "Объяснить · ИИ", exact: true }),
  ).toHaveCount(0);
  await gap.getByRole("combobox").selectOption({ label: "неверный-один" });
  await gap.getByRole("button", { name: "Проверить", exact: true }).click();
  await gap
    .getByRole("button", { name: "Объяснить · ИИ", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "ИИ-тьютор", exact: true });
  await expect(
    panel.getByRole("article", { name: "Ответ тьютора" }),
  ).toContainText("[1]");
  await expect(
    panel.getByText("Осталось вопросов: 4", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Начать тест", exact: true }).click();
  const question = page.locator("form").filter({
    has: page.getByRole("group", { name: /Вопрос 1: какой вариант выбрать/ }),
  });
  await question.getByRole("radio", { name: "Вариант А", exact: true }).check();
  await question
    .getByRole("button", { name: "Проверить", exact: true })
    .click();
  await question
    .getByRole("button", { name: "Объяснить · ИИ", exact: true })
    .click();
  await expect(
    panel.getByRole("article", { name: "Ответ тьютора" }),
  ).toHaveCount(2);
  await expect(
    panel.getByText("Осталось вопросов: 3", { exact: true }),
  ).toBeVisible();
  await expect(
    panel
      .getByRole("article", { name: "Ответ тьютора" })
      .last()
      .getByRole("button", { name: "Неточно", exact: true }),
  ).toBeVisible();
  await mkdir("tmp/screenshots", { recursive: true });
  await panel.screenshot({
    path: `tmp/screenshots/tutor-explain-${info.project.name}.png`,
  });
  const prompts = await db.tutorMessage.findMany({
    where: { conversation: { subjectId: f.subject.id }, role: "USER" },
    orderBy: { createdAt: "asc" },
  });
  expect(prompts[0].content).toContain("неверный-один");
  expect(prompts[1].content).toContain("Вариант Б");
});
test("signed learner uses the subject page; API guards origin, access, payload and replay", async ({
  page,
  context,
}, info) => {
  const legal = await currentLegal(),
    user = await db.user.create({
      data: {
        email: `tutor-browser-${randomUUID()}@example.test`,
        name: "Студент фикстуры",
        timezone: "Asia/Yekaterinburg",
        consentPdAt: new Date(),
        consentPdVersion: legal.consent.version,
        offerVersion: legal.offer.version,
      },
    });
  users.push(user.id);
  const token = newToken();
  await db.session.create({
    data: {
      userId: user.id,
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
  await page.goto(`/tutor?subject=${f.subject.id}`);
  await expect(
    page.getByRole("heading", { name: "ИИ-тьютор", level: 1, exact: true }),
  ).toBeVisible();
  const panel = page.getByRole("region", { name: "ИИ-тьютор", exact: true });
  await expect(
    panel.getByText("Осталось вопросов: 15", { exact: true }),
  ).toBeVisible();
  const input = {
    kind: "question",
    subjectId: f.subject.id,
    text: "Первый выбор",
    requestId: randomUUID(),
  };
  expect(
    (
      await page.request.post("/api/tutor", {
        headers: { Origin: "https://foreign.example" },
        data: input,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/tutor", {
        headers: { Origin: origin },
        data: { ...input, userId: "forged" },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await page.request.post("/api/tutor", {
        headers: { Origin: origin },
        data: { ...input, topicId: f.paid.id },
      })
    ).status(),
  ).toBe(403);
  const first = await page.request.post("/api/tutor", {
    headers: { Origin: origin },
    data: input,
  });
  expect(first.headers()["content-type"]).toContain("text/event-stream");
  expect(first.headers()["cache-control"]).toContain("no-store");
  expect(await first.text()).toContain('"type":"done"');
  const replay = await page.request.post("/api/tutor", {
    headers: { Origin: origin },
    data: input,
  });
  expect(await replay.text()).toContain('"type":"done"');
  expect(
    await db.tutorMessage.count({
      where: { conversation: { userId: user.id }, role: "ASSISTANT" },
    }),
  ).toBe(1);
  await page.reload();
  await expect(
    panel.getByText("Осталось вопросов: 14", { exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("textbox", { name: "Ваш вопрос", exact: true })
    .fill("Первый выбор");
  await panel
    .getByRole("button", { name: "Задать вопрос", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Полезно", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mkdir("tmp/screenshots", { recursive: true });
  await page.screenshot({
    path: `tmp/screenshots/tutor-page-${info.project.name}.png`,
    fullPage: true,
  });
});
