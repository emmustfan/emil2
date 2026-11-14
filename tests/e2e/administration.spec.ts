import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { getDb } from "../../lib/db";
import { currentLegal } from "../../lib/auth/legal";
import { hashToken, newToken } from "../../lib/auth/crypto";
import { anonymizeAccount } from "../../lib/auth/deletion";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
const db = getDb(),
  origin = "http://localhost:3100";
let f: LessonFixture,
  other: LessonFixture,
  planId: string,
  code: string,
  admin: string,
  student: string,
  teacher: string;
const users: string[] = [],
  contexts: BrowserContext[] = [],
  documents: string[] = [],
  auditIds: string[] = [],
  eventIds: bigint[] = [];
test.setTimeout(90000);
async function user(role: "ADMIN" | "USER" | "EDITOR") {
  const legal = await currentLegal(),
    u = await db.user.create({
      data: {
        email: `admin-browser-${randomUUID()}@example.test`,
        emailVerifiedAt: new Date(),
        name: "Участник проверки кабинета",
        role,
        consentPdAt: new Date(),
        consentPdVersion: legal.consent.version,
        offerVersion: legal.offer.version,
      },
    });
  users.push(u.id);
  return u.id;
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
test.beforeEach(async ({ context, page }) => {
  f = await createLessonFixture("admin-browser");
  other = await createLessonFixture("admin-browser-other");
  admin = await user("ADMIN");
  student = await user("USER");
  teacher = await user("EDITOR");
  const p = await db.plan.create({
    data: {
      code: `admin-browser-${randomUUID()}`,
      title: "Тариф проверки кабинета",
      kind: "SUBJECT",
      priceKopecks: 12300,
      periodMonths: 1,
      tutorDailyLimit: 99,
      features: ["Проверяемый доступ"],
    },
  });
  planId = p.id;
  code = p.code;
  await signIn(context, admin);
  await page.route("https://telegram.org/**", (r) => r.abort());
});
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  await db.legalDocument.deleteMany({
    where: { id: { in: documents.splice(0) } },
  });
  const ps = await db.payment.findMany({
    where: { planId },
    select: { id: true, providerPaymentId: true },
  });
  await db.paymentRefund.deleteMany({
    where: { paymentId: { in: ps.map((p) => p.id) } },
  });
  await db.mockProviderRecord.deleteMany({
    where: {
      id: {
        in: ps.flatMap((p) =>
          p.providerPaymentId
            ? [p.providerPaymentId, `rule:method_${p.providerPaymentId}`]
            : [],
        ),
      },
    },
  });
  await db.billingMail.deleteMany({ where: { userId: { in: users } } });
  await db.payment.deleteMany({ where: { planId } });
  await db.subscription.deleteMany({ where: { planId } });
  await db.plan.delete({ where: { id: planId } });
  await db.securityAudit.deleteMany({
    where: {
      OR: [
        { actorId: { in: users } },
        { targetId: { in: users } },
        { id: { in: auditIds.splice(0) } },
      ],
    },
  });
  await db.event.deleteMany({ where: { id: { in: eventIds.splice(0) } } });
  await db.teacherSubject.deleteMany({
    where: {
      OR: [{ teacherId: { in: users } }, { assignedById: { in: users } }],
    },
  });
  await cleanupLessonFixture(other);
  await cleanupLessonFixture(f, [], users.splice(0));
});
test.afterAll(async () => {
  await db.$disconnect();
});
test("administrator changes a price and quota without redeploy and the learner sees the new quota", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/admin/settings?section=plans");
  const form = page.locator("form").filter({
    has: page.getByRole("heading", {
      name: "Тариф проверки кабинета",
      exact: true,
    }),
  });
  await form
    .getByRole("textbox", { name: "Цена, ₽", exact: true })
    .fill("456.78");
  await form
    .getByRole("spinbutton", { name: "Вопросов ИИ в день", exact: true })
    .fill("87");
  await form
    .getByRole("button", { name: "Сохранить тариф", exact: true })
    .click();
  await expect(form.getByRole("status")).toHaveText("Сохранено.");
  const learner = await browser.newContext({
    baseURL: origin,
    viewport: testInfo.project.use.viewport,
  });
  contexts.push(learner);
  await signIn(learner, student);
  const learn = await learner.newPage();
  await learn.goto(`/pricing?plan=${code}&subject=${f.subject.id}`);
  await expect(
    learn.getByRole("radio", { name: /Тариф проверки кабинета/ }),
  ).toBeChecked();
  await expect(learn.getByText(/456,78/).first()).toBeVisible();
  await db.subscription.create({
    data: {
      userId: student,
      planId,
      subjectId: f.subject.id,
      status: "ACTIVE",
      autoRenew: false,
      priceKopecks: 12300,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
    },
  });
  await learn.goto("/cabinet");
  await expect(
    learn.getByText(/Осталось вопросов ИИ сегодня: 87 из 87/),
  ).toBeVisible();
  expect(
    (await db.subscription.findFirstOrThrow({ where: { userId: student } }))
      .priceKopecks,
  ).toBe(12300);
  await page.goto("/admin/settings?section=limits");
  const label = "Пауза автосохранения: миллисекунд",
    setting = page.locator("form").filter({
      has: page.getByRole("spinbutton", { name: label, exact: true }),
    }),
    input = setting.getByRole("spinbutton", { name: label, exact: true }),
    old = await input.inputValue();
  try {
    await input.fill(String(Number(old) + 100));
    await setting
      .getByRole("button", { name: "Сохранить настройку", exact: true })
      .click();
    await expect(setting.getByRole("status")).toHaveText("Сохранено.");
    await page.reload();
    await expect(
      page.getByRole("spinbutton", { name: label, exact: true }),
    ).toHaveValue(String(Number(old) + 100));
  } finally {
    const restore = page.locator("form").filter({
      has: page.getByRole("spinbutton", { name: label, exact: true }),
    });
    await restore
      .getByRole("spinbutton", { name: label, exact: true })
      .fill(old);
    await restore
      .getByRole("button", { name: "Сохранить настройку", exact: true })
      .click();
    await expect(restore.getByRole("status")).toHaveText("Сохранено.");
  }
  await page.goto("/admin/dashboard");
  await expect(
    page.getByRole("heading", { name: "Статистика платформы", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Воронка за период", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mkdir("tmp/screenshots", { recursive: true });
  await page.screenshot({
    path: `tmp/screenshots/admin-stage-8-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test("administrator grants and revokes access while teacher sees only their tutor logs", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto(`/admin/users/${student}`);
  await page
    .getByRole("combobox", { name: "Область доступа", exact: true })
    .selectOption(f.subject.id);
  await page
    .getByRole("textbox", { name: "Причина выдачи", exact: true })
    .fill("Проверка ручного доступа");
  await page
    .getByRole("button", { name: "Выдать доступ", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Отозвать ручной доступ", exact: true }),
  ).toBeVisible();
  const learner = await browser.newContext({
    baseURL: origin,
    viewport: testInfo.project.use.viewport,
  });
  contexts.push(learner);
  await signIn(learner, student);
  const learn = await learner.newPage();
  await learn.goto(`/learn/${f.subject.slug}/${f.paid.slug}`);
  await expect(
    learn.getByText("ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Отозвать ручной доступ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Подтвердить отзыв доступа", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Отозвать ручной доступ", exact: true }),
  ).toHaveCount(0);
  await learn.reload();
  await expect(
    learn.getByText("ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ."),
  ).toHaveCount(0);
  await db.teacherSubject.create({
    data: { teacherId: teacher, subjectId: f.subject.id, assignedById: admin },
  });
  for (const [subjectId, content] of [
    [f.subject.id, "Ответ по закреплённому предмету"],
    [other.subject.id, "ЧУЖОЙ_ОТВЕТ"],
  ]) {
    const c = await db.tutorConversation.create({
        data: { subjectId, userId: student },
      }),
      q = await db.tutorMessage.create({
        data: {
          conversationId: c.id,
          role: "USER",
          content: "Проверочный вопрос",
        },
      });
    await db.tutorMessage.create({
      data: {
        conversationId: c.id,
        replyToId: q.id,
        role: "ASSISTANT",
        content,
        feedback: -1,
        citations: [],
        tokensIn: 10,
        tokensOut: 5,
      },
    });
  }
  const staff = await browser.newContext({
    baseURL: origin,
    viewport: testInfo.project.use.viewport,
  });
  contexts.push(staff);
  await signIn(staff, teacher);
  const teach = await staff.newPage();
  await teach.goto("/admin/tutor-logs?inaccurate=yes");
  await expect(
    teach.getByText("Ответ по закреплённому предмету", { exact: true }),
  ).toBeVisible();
  await expect(teach.getByText("ЧУЖОЙ_ОТВЕТ", { exact: true })).toHaveCount(0);
  expect((await staff.request.get("/admin/settings")).status()).toBe(403);
  expect(
    (
      await staff.request.post("/api/admin/manage/settings", {
        headers: { Origin: origin },
        data: { key: "lesson.passThreshold", revision: null, value: 0.8 },
      })
    ).status(),
  ).toBe(403);
});
test("learner resumes with explicit consent and unlinks a card while keeping paid access", async ({
  page,
  context,
}) => {
  await signIn(context, student);
  await page.goto(`/pricing?plan=${code}&subject=${f.subject.id}`);
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
  await page.goto("/cabinet/subscription");
  await page
    .getByRole("button", { name: "Отключить автопродление", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Подтвердить отключение", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Возобновить автопродление",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Возобновить автопродление", exact: true })
    .click();
  const checkbox = page.getByRole("checkbox", {
    name: /Соглашаюсь на автопродление/,
  });
  await expect(checkbox).not.toBeChecked();
  const resume = page.getByRole("button", {
    name: "Подтвердить: возобновить автопродление",
    exact: true,
  });
  await expect(resume).toBeDisabled();
  await checkbox.check();
  await resume.click();
  await expect(
    page.getByRole("button", { name: "Отключить автопродление", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Отвязать карту", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Подтвердить: отвязать карту", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Отвязать карту", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Возобновить автопродление",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto(`/learn/${f.subject.slug}/${f.paid.slug}`);
  await expect(
    page.getByText("ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ."),
  ).toBeVisible();
});
test("legal editor adds a distinct version and deletion requires typing a confirmation", async ({
  page,
  context,
}) => {
  await page.goto("/admin/settings?section=legal");
  await page
    .getByRole("combobox", { name: "Документ", exact: true })
    .selectOption("privacy");
  const version = `fixture-${randomUUID()}`,
    content =
      "Только тестовый документ для автоматической проверки. Не юридический текст.";
  await page
    .getByRole("textbox", { name: "Номер новой версии", exact: true })
    .fill(version);
  await page
    .getByRole("textbox", { name: "Текст документа", exact: true })
    .fill(content);
  await page
    .getByRole("checkbox", {
      name: "Подтверждаю размещение новой версии для пользователей",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Разместить новую версию", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Сохранено.");
  const d = await db.legalDocument.findUniqueOrThrow({
    where: { kind_version: { kind: "privacy", version } },
  });
  documents.push(d.id);
  await page.goto("/legal/privacy");
  await expect(page.getByText(content, { exact: true })).toBeVisible();
  await signIn(context, student);
  await page.goto("/cabinet/profile");
  await page
    .getByRole("button", { name: "Удалить аккаунт", exact: true })
    .click();
  const remove = page.getByRole("button", {
    name: "Удалить аккаунт окончательно",
    exact: true,
  });
  await expect(remove).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Подтверждение удаления", exact: true })
    .fill("УДАЛИТЬ");
  await remove.click();
  await expect(page).toHaveURL(/\/login\?deleted=1/);
  expect(
    (
      await context.request.post("/api/profile", {
        headers: { Origin: origin },
        data: {
          name: "Старый запрос",
          university: "",
          course: null,
          timezone: "Europe/Moscow",
        },
      })
    ).status(),
  ).toBe(401);
  auditIds.push(
    ...(
      await db.securityAudit.findMany({
        where: { OR: [{ actorId: student }, { targetId: student }] },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  eventIds.push(
    ...(
      await db.event.findMany({
        where: { userId: student },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  await anonymizeAccount(student);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: student } })).email,
  ).toBeNull();
});
