import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { getDb } from "../../lib/db";
import { hashToken } from "../../lib/auth/crypto";
import { createDemoFixture } from "../helpers/demo-fixture";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
const db = getDb();
let demo: Awaited<ReturnType<typeof createDemoFixture>>,
  paid: LessonFixture,
  email: string,
  plan: { id: string; code: string };
test.setTimeout(120000);
test.beforeEach(async ({ context, page }) => {
  demo = await createDemoFixture("mvp-demo");
  paid = await createLessonFixture("mvp-paid");
  email = `mvp-${randomUUID()}@example.test`;
  await db.subject.update({
    where: { id: demo.subject.id },
    data: { title: "Демо сквозного сценария MVP" },
  });
  plan = await db.plan.create({
    data: {
      code: `mvp-${randomUUID()}`,
      title: "Тариф сквозного сценария",
      kind: "SUBJECT",
      priceKopecks: 12300,
      periodMonths: 1,
      tutorDailyLimit: 150,
      features: ["Синтетическая проверка"],
    },
  });
  await context.setExtraHTTPHeaders({
    "X-Real-IP": `192.0.2.${Math.floor(Math.random() * 180) + 20}`,
  });
  await page.route("https://telegram.org/**", (r) => r.abort());
  await page.route("https://oauth.telegram.org/**", (r) => r.abort());
});
test.afterEach(async ({ context }) => {
  const user = await db.user.findUnique({ where: { email } }),
    ids = user ? [user.id] : [],
    payments = await db.payment.findMany({ where: { planId: plan.id } });
  await db.mockProviderRecord.deleteMany({
    where: {
      id: {
        in: payments.flatMap((p) =>
          p.providerPaymentId
            ? [p.providerPaymentId, `rule:method_${p.providerPaymentId}`]
            : [],
        ),
      },
    },
  });
  await db.billingMail.deleteMany({ where: { userId: { in: ids } } });
  await db.paymentRefund.deleteMany({
    where: { paymentId: { in: payments.map((p) => p.id) } },
  });
  await db.payment.deleteMany({ where: { planId: plan.id } });
  await db.subscription.deleteMany({ where: { planId: plan.id } });
  await db.plan.delete({ where: { id: plan.id } });
  await db.loginToken.deleteMany({ where: { email } });
  const token = (await context.cookies()).find(
      (c) => c.name === "demo_sid",
    )?.value,
    demos = token
      ? await db.demoSession.findMany({
          where: { anonId: hashToken(token) },
          select: { id: true },
        })
      : [];
  await cleanupLessonFixture(
    demo,
    demos.map((d) => d.id),
  );
  await cleanupLessonFixture(paid, [], ids);
});
test.afterAll(async () => {
  await db.$disconnect();
});
test("one browser follows demo → email login → payment → paid lesson → repetition", async ({
  page,
}) => {
  await page.goto("/demo");
  await page
    .getByRole("button", {
      name: "Пропустить — просто покажите урок",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Демо сквозного сценария MVP", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Попробуйте бесплатный урок" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Дальше — попробовать повторение" })
    .click();
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
  await page
    .getByRole("textbox", { name: "Имя", exact: true })
    .fill("Ученик MVP");
  await page
    .getByRole("checkbox", {
      name: "Даю согласие на обработку персональных данных",
    })
    .check();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(page).toHaveURL(/\/cabinet$/);
  await page.goto(`/learn/${paid.subject.slug}/${paid.paid.slug}`);
  await expect(
    page.getByText("ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ.", { exact: true }),
  ).not.toBeVisible();
  await page.goto(`/pricing?plan=${plan.code}&subject=${paid.subject.id}`);
  await page
    .getByRole("checkbox", { name: /Соглашаюсь на автопродление/ })
    .check();
  await page.getByRole("button", { name: /Тестовая оплата ·/ }).click();
  await page
    .getByRole("button", { name: "Оплатить в тестовом режиме", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Доступ открыт", exact: true }),
  ).toBeVisible();
  await page.goto(`/learn/${paid.subject.slug}/${paid.paid.slug}`);
  await expect(
    page.getByText("ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ.", { exact: true }),
  ).toBeVisible();
  const form = page.locator('form[id^="exercise-"]').first();
  await form.getByRole("radio", { name: "неверный-один", exact: true }).check();
  await form.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Неверно");
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(
    await db.card.count({ where: { userId: user.id, topicId: paid.paid.id } }),
  ).toBe(1);
  await page.goto("/review");
  await page
    .getByRole("button", { name: "Показать ответ", exact: true })
    .click();
  await expect(
    page.getByLabel("Ответ карточки", { exact: true }),
  ).toContainText("верный-один");
  await page.getByRole("button", { name: "Норм 1 дн", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "На сегодня всё", exact: true }),
  ).toBeVisible();
  const card = await db.card.findFirstOrThrow({
    where: { userId: user.id, topicId: paid.paid.id },
  });
  expect(card.reps).toBe(1);
  expect(card.dueAt.getTime()).toBeGreaterThan(Date.now());
});
