import { lessonGap } from "../helpers/inline-gap";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { getDb } from "../../lib/db";
import { hashToken } from "../../lib/auth/crypto";
import { createDemoFixture } from "../helpers/demo-fixture";
import { cleanupLessonFixture } from "../helpers/lesson-fixture";
const db = getDb();
let f: Awaited<ReturnType<typeof createDemoFixture>>;
const users: string[] = [];
let email: string;
test.setTimeout(90000);
test.beforeEach(async ({ page, context }) => {
  f = await createDemoFixture("demo-browser");
  email = `demo-${randomUUID()}@example.test`;
  await db.subject.update({
    where: { id: f.subject.id },
    data: { title: "Демо для браузерной проверки" },
  });
  await context.setExtraHTTPHeaders({
    "X-Real-IP": `192.0.2.${Math.floor(Math.random() * 180) + 20}`,
  });
  await page.route("https://telegram.org/**", (route) => route.abort());
  await page.route("https://oauth.telegram.org/**", (route) => route.abort());
});
test.afterEach(async ({ context }) => {
  const token = (await context.cookies()).find(
    (c) => c.name === "demo_sid",
  )?.value;
  const demos = token
    ? await db.demoSession.findMany({
        where: { anonId: hashToken(token) },
        select: { id: true },
      })
    : [];
  await db.loginToken.deleteMany({ where: { email } });
  const account = await db.user.findUnique({ where: { email } });
  if (account) users.push(account.id);
  await cleanupLessonFixture(
    f,
    demos.map((d) => d.id),
    users.splice(0),
  );
});
test.afterAll(async () => {
  await db.$disconnect();
});
test("full demo resumes and transfers diagnostic, lesson, cards and attribution after email consent", async ({
  page,
}) => {
  await page.goto("/demo?utm_source=demo-browser&utm_campaign=first");
  await page.getByRole("button", { name: "Сдать сессию", exact: true }).click();
  await page
    .getByRole("button", { name: "Демо для браузерной проверки", exact: true })
    .click();
  for (let i = 0; i < 3; i++) {
    await expect(
      page.getByText(`Вопрос ${i + 1} из 3.`, { exact: false }),
    ).toBeVisible();
    const card = page.locator('form[id^="exercise-"]');
    await card.getByRole("radio", { name: "Вариант Б", exact: true }).check();
    await card.getByRole("button", { name: "Проверить", exact: true }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Ваш результат: 3 из 3" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ваш результат: 3 из 3" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Попробовать урок", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Попробуйте бесплатный урок" }),
  ).toBeVisible();
  for (const [index, label] of ["верный-один", "верный-два"].entries()) {
    const card = lessonGap(page, index + 1);
    await card.getByRole("combobox").selectOption({ label });
    await card.getByRole("button", { name: "Проверить", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Дальше — попробовать повторение" })
    .click();
  await expect(page.getByText("Повторено: 0 из 2")).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "Показать ответ", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Норм · 1 дн", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Дальше — сохранить прогресс" })
    .click();
  await page
    .getByRole("link", {
      name: "Сохранить — войти по почте или через Telegram",
    })
    .click();
  await page.getByRole("textbox", { name: "Электронная почта" }).fill(email);
  await page.getByRole("button", { name: "Получить ссылку" }).click();
  await expect(page.getByRole("status")).toContainText("Проверьте почту");
  let token = "";
  for (const name of await readdir("tmp/mails")) {
    const mail = JSON.parse(await readFile(`tmp/mails/${name}`, "utf8"));
    if (mail.to === email)
      token = new URL(mail.text.match(/http[^\s]+/)[0]).searchParams.get(
        "token",
      )!;
  }
  expect(token).toBeTruthy();
  await page.goto(`/auth/verify?token=${token}`);
  await page.getByRole("button", { name: "Подтвердить вход" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const before = await db.user.findUniqueOrThrow({ where: { email } });
  expect(await db.card.count({ where: { userId: before.id } })).toBe(0);
  await page
    .getByRole("textbox", { name: "Имя", exact: true })
    .fill("Ученик демо");
  await page
    .getByRole("checkbox", {
      name: "Даю согласие на обработку персональных данных",
    })
    .check();
  // Exercise native submission too: a fast click before hydration must still
  // POST consent and transfer progress rather than putting profile data in a URL.
  await page
    .locator("form")
    .filter({ has: page.getByRole("textbox", { name: "Имя", exact: true }) })
    .evaluate((form) => HTMLFormElement.prototype.submit.call(form));
  await expect(page).toHaveURL(/\/cabinet$/);
  await expect(
    page.getByText("Диагностика: 3 из 3.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Пропусков: 2, верно: 2.", { exact: false }),
  ).toBeVisible();
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user.utm).toEqual({
    utm_source: "demo-browser",
    utm_campaign: "first",
  });
  expect(await db.card.count({ where: { userId: user.id, reps: 1 } })).toBe(2);
  await page.goto(`/learn/${f.subject.slug}/${f.free.slug}`);
  await expect(lessonGap(page, 1).getByRole("status")).toContainText("Верно");
});
test("skip branch creates no diagnostic and client event endpoint rejects forged conversions", async ({
  page,
  request,
}) => {
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "Пропустить — просто покажите урок" })
    .click();
  await page
    .getByRole("button", { name: "Демо для браузерной проверки", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Попробуйте бесплатный урок" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Дальше — попробовать повторение" })
    .click();
  await expect(page.getByText("Повторено: 0 из 0")).toBeVisible();
  await page
    .getByRole("button", { name: "Дальше — сохранить прогресс" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Сохраните прогресс — продолжите там же",
    }),
  ).toBeVisible();
  const forged = await page.request.post("/api/events", {
    headers: { Origin: "http://localhost:3100" },
    data: { name: "demo_completed", props: {} },
  });
  expect(forged.status()).toBe(422);
  const csrf = await request.post("/api/demo", {
    headers: { Origin: "https://foreign.test" },
    data: { action: "finish" },
  });
  expect(csrf.status()).toBe(403);
});

test("an existing consenting account receives guest progress immediately at email verification", async ({
  page,
}) => {
  const legal = await db.legalDocument.findMany({
    where: {
      kind: { in: ["consent", "oferta"] },
      publishedAt: { lte: new Date() },
    },
    orderBy: { publishedAt: "desc" },
  });
  const account = await db.user.create({
    data: {
      email,
      emailVerifiedAt: new Date(),
      name: "Уже зарегистрирован",
      consentPdAt: new Date(),
      consentPdVersion: legal.find((d) => d.kind === "consent")!.version,
      offerVersion: legal.find((d) => d.kind === "oferta")!.version,
    },
  });
  await page.goto(`/learn/${f.subject.slug}/${f.free.slug}`);
  const first = lessonGap(page, 1);
  await first.getByRole("combobox").selectOption({ label: "верный-один" });
  await first.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(first.getByRole("status")).toContainText("Верно");
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Электронная почта" }).fill(email);
  await page.getByRole("button", { name: "Получить ссылку" }).click();
  await expect(page.getByRole("status")).toContainText("Проверьте почту");
  let token = "";
  for (const file of await readdir("tmp/mails")) {
    const mail = JSON.parse(await readFile(`tmp/mails/${file}`, "utf8"));
    if (mail.to === email)
      token = new URL(mail.text.match(/http[^\s]+/)[0]).searchParams.get(
        "token",
      )!;
  }
  await page.goto(`/auth/verify?token=${token}`);
  await page.getByRole("button", { name: "Подтвердить вход" }).click();
  await expect(page).toHaveURL(/\/cabinet$/);
  expect(await db.gapAnswer.count({ where: { userId: account.id } })).toBe(1);
  expect(await db.card.count({ where: { userId: account.id } })).toBe(1);
  expect(
    await db.event.count({
      where: { userId: account.id, name: "signup_completed" },
    }),
  ).toBe(0);
});
