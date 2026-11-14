import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readdir, readFile, mkdir } from "node:fs/promises";
import { getDb } from "../../lib/db";
import { currentLegal } from "../../lib/auth/legal";
import { newToken, hashToken } from "../../lib/auth/crypto";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
const db = getDb(),
  origin = "http://localhost:3100";
let f: LessonFixture, code: string, planId: string;
const users: string[] = [],
  contexts: BrowserContext[] = [];
let email: string;
test.setTimeout(90000);
async function user(role: "USER" | "ADMIN" | "EDITOR" = "USER") {
  const docs = await currentLegal();
  const u = await db.user.create({
    data: {
      email: `billing-browser-${randomUUID()}@example.test`,
      emailVerifiedAt: new Date(),
      name: "Ученик оплаты",
      role,
      consentPdAt: new Date(),
      consentPdVersion: docs.consent.version,
      offerVersion: docs.offer.version,
      timezone: "Asia/Yekaterinburg",
    },
  });
  users.push(u.id);
  return u;
}
async function signIn(context: BrowserContext, userId: string) {
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
}
async function checkout(page: Page) {
  await page.goto(`/pricing?plan=${code}&subject=${f.subject.id}`);
  await expect(
    page.getByRole("radio", { name: /Тариф проверки оплаты/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Предмет", exact: true }),
  ).toHaveValue(f.subject.id);
  const consent = page.getByRole("checkbox", {
    name: /Соглашаюсь на автопродление/,
  });
  await expect(consent).not.toBeChecked();
  const pay = page.getByRole("button", { name: /Тестовая оплата ·/ });
  await expect(pay).toBeDisabled();
  await consent.check();
  await pay.click();
  await expect(page).toHaveURL(/\/dev\/mock-pay\//);
  return new URL(page.url()).pathname.split("/").at(-1)!;
}
async function pay(page: Page) {
  const id = await checkout(page);
  await page
    .getByRole("button", { name: "Оплатить в тестовом режиме", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Доступ открыт", exact: true }),
  ).toBeVisible();
  return id;
}
test.beforeEach(async ({ page, context }) => {
  f = await createLessonFixture("billing-browser");
  const p = await db.plan.create({
    data: {
      code: `billing-browser-${randomUUID()}`,
      kind: "SUBJECT",
      title: "Тариф проверки оплаты",
      priceKopecks: 12300,
      periodMonths: 1,
      tutorDailyLimit: 150,
      features: ["Доступ к тестовому предмету"],
    },
  });
  planId = p.id;
  code = p.code;
  email = `billing-login-${randomUUID()}@example.test`;
  await context.setExtraHTTPHeaders({
    "X-Real-IP": `192.0.2.${Math.floor(Math.random() * 180) + 20}`,
  });
  await page.route("https://telegram.org/**", (r) => r.abort());
  await page.route("https://oauth.telegram.org/**", (r) => r.abort());
});
test.afterEach(async ({ context }) => {
  for (const c of contexts.splice(0)) await c.close();
  const created = await db.user.findUnique({ where: { email } });
  if (created && !users.includes(created.id)) users.push(created.id);
  const paymentRows = await db.payment.findMany({
      where: { planId },
      select: { id: true, providerPaymentId: true },
    }),
    ids = paymentRows.map((p) => p.id);
  const refunds = await db.paymentRefund.findMany({
    where: { paymentId: { in: ids } },
    select: { providerRefundId: true },
  });
  await db.mockProviderRecord.deleteMany({
    where: {
      id: {
        in: paymentRows
          .flatMap((p) =>
            p.providerPaymentId
              ? [p.providerPaymentId, `rule:method_${p.providerPaymentId}`]
              : [],
          )
          .concat(
            refunds.flatMap((r) =>
              r.providerRefundId ? [r.providerRefundId] : [],
            ),
          ),
      },
    },
  });
  await db.billingMail.deleteMany({ where: { userId: { in: users } } });
  await db.paymentRefund.deleteMany({ where: { paymentId: { in: ids } } });
  await db.payment.deleteMany({ where: { id: { in: ids } } });
  await db.subscription.deleteMany({ where: { planId } });
  await db.plan.delete({ where: { id: planId } });
  await db.loginToken.deleteMany({ where: { email } });
  const token = (await context.cookies()).find(
    (c) => c.name === "demo_sid",
  )?.value;
  const demos = token
    ? await db.demoSession.findMany({
        where: { anonId: hashToken(token) },
        select: { id: true },
      })
    : [];
  await cleanupLessonFixture(
    f,
    demos.map((d) => d.id),
    users.splice(0),
  );
});
test.afterAll(async () => {
  await db.$disconnect();
});
test("learner pays with explicit consent, opens a locked lesson and cancels future charges", async ({
  page,
  context,
}, testInfo) => {
  const u = await user();
  await signIn(context, u.id);
  const id = await pay(page);
  await page.goto(`/learn/${f.subject.slug}/${f.paid.slug}`);
  await expect(
    page.getByText("ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ.", { exact: true }),
  ).toBeVisible();
  await page.goto("/cabinet/subscription");
  const history = page.getByRole("table", {
    name: "История платежей",
    exact: true,
  });
  await expect(
    history.getByRole("cell", { name: "Оплачен", exact: true }),
  ).toBeVisible();
  await expect(history.locator("tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Отключить автопродление", exact: true })
    .click();
  await expect(
    page.getByText("Отключить следующие списания?", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Подтвердить отключение", exact: true })
    .click();
  await expect(
    page.getByText("Автопродление отключено.", { exact: false }),
  ).toBeVisible();
  const sub = await db.subscription.findFirstOrThrow({
    where: { userId: u.id },
  });
  expect(sub.autoRenew).toBe(false);
  expect(sub.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
  expect((await db.payment.findUniqueOrThrow({ where: { id } })).status).toBe(
    "SUCCEEDED",
  );
  await mkdir("tmp/screenshots", { recursive: true });
  await page.screenshot({
    path: `tmp/screenshots/billing-stage-7-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("declined mock payment never grants access and API rejects forged consent and webhooks", async ({
  page,
  context,
}) => {
  const u = await user();
  await signIn(context, u.id);
  const bad = await page.request.post("/api/checkout", {
    headers: { Origin: origin },
    data: {
      requestId: randomUUID(),
      planCode: code,
      subjectId: f.subject.id,
      amountKopecks: 12300,
      periodMonths: 1,
      buyerEmail: u.email,
      renewalConsent: false,
      renewalConsentVersion: "1",
      offerVersion: (await currentLegal()).offer.version,
    },
  });
  expect(bad.status()).toBe(422);
  const hook = await page.request.post("/api/webhooks/yookassa", {
    data: {
      type: "notification",
      event: "payment.succeeded",
      object: { id: "forged", status: "succeeded" },
    },
  });
  expect(hook.status()).toBe(403);
  const id = await checkout(page);
  await page
    .getByRole("button", { name: "Отклонить тестовый платёж", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Оплата отменена", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Тестовый платёж отклонён.", { exact: true }),
  ).toBeVisible();
  expect(await db.subscription.count({ where: { userId: u.id } })).toBe(0);
  expect((await db.payment.findUniqueOrThrow({ where: { id } })).status).toBe(
    "CANCELED",
  );
  await page.goto(`/learn/${f.subject.slug}/${f.paid.slug}`);
  await expect(
    page.getByRole("heading", { name: /Откройте предмет/ }),
  ).toBeVisible();
});
test("only administrator can refund and refunded access closes in an existing browser session", async ({
  page,
  context,
  browser,
}) => {
  const u = await user();
  await signIn(context, u.id);
  const id = await pay(page);
  const denied = await page.request.post(`/api/admin/payments/${id}/refund`, {
    headers: { Origin: origin },
    data: { confirm: true },
  });
  expect(denied.status()).toBe(403);
  const admin = await user("ADMIN"),
    adminContext = await browser.newContext({ baseURL: origin });
  contexts.push(adminContext);
  await signIn(adminContext, admin.id);
  const staff = await adminContext.newPage();
  await staff.goto("/admin/payments?status=SUCCEEDED");
  const card = staff.locator("article").filter({ hasText: id });
  await card
    .getByRole("button", { name: "Вернуть деньги", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Подтвердить полный возврат", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.payment.findUniqueOrThrow({ where: { id } })).status,
    )
    .toBe("REFUNDED");
  await staff.goto("/admin/payments?status=REFUNDED");
  await expect(
    staff
      .locator("article")
      .filter({ hasText: id })
      .getByText("Возврат: выполнен", { exact: true }),
  ).toBeVisible();
  expect((await db.payment.findUniqueOrThrow({ where: { id } })).status).toBe(
    "REFUNDED",
  );
  await page.goto(`/learn/${f.subject.slug}/${f.paid.slug}`);
  await expect(
    page.getByRole("heading", { name: /Откройте предмет/ }),
  ).toBeVisible();
  expect(await page.content()).not.toContain(
    "ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ",
  );
});
test("guest returns to the chosen plan after email login and onboarding with consent still unchecked", async ({
  page,
}) => {
  await page.goto(`/pricing?plan=${code}&subject=${f.subject.id}`);
  await page
    .getByRole("link", { name: "Войти и продолжить оформление", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByRole("textbox", { name: "Электронная почта" }).fill(email);
  await page
    .getByRole("button", { name: "Получить ссылку", exact: true })
    .click();
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
  await page
    .getByRole("button", { name: "Подтвердить вход", exact: true })
    .click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page
    .getByRole("textbox", { name: "Имя", exact: true })
    .fill("Ученик оплаты");
  await page
    .getByRole("checkbox", {
      name: "Даю согласие на обработку персональных данных",
    })
    .check();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(page).toHaveURL(/\/pricing\?/);
  await expect(
    page.getByRole("radio", { name: /Тариф проверки оплаты/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Предмет", exact: true }),
  ).toHaveValue(f.subject.id);
  await expect(
    page.getByRole("checkbox", { name: /Соглашаюсь на автопродление/ }),
  ).not.toBeChecked();
  const u = await db.user.findUniqueOrThrow({ where: { email } });
  expect(await db.payment.count({ where: { userId: u.id } })).toBe(0);
});
