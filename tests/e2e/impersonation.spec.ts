import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { getDb } from "../../lib/db";
import {
  createImpersonationFixture,
  type ImpersonationFixture,
} from "../helpers/impersonation-fixture";
import { lessonGap } from "../helpers/inline-gap";
const db = getDb();
let f: ImpersonationFixture;
test.setTimeout(120000);
test.beforeEach(async ({ context }) => {
  f = await createImpersonationFixture();
  await context.addCookies([
    {
      name: "sid",
      value: f.adminSid,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
});
test.afterEach(async ({ context }) => {
  for (const page of context.pages()) await page.close();
  await f.cleanup();
});
test.afterAll(async () => {
  await db.$disconnect();
});
test("administrator views a demo student, cannot answer, exits and sees the audit without changing the student's data", async ({
  page,
  context,
}, info) => {
  await db.payment.update({
    where: { id: f.payment.id },
    data: { status: "SUCCEEDED" },
  });
  await page.goto(`/admin/users/${f.student.id}/progress`);
  await page
    .getByRole("button", {
      name: "Посмотреть как этот пользователь",
      exact: true,
    })
    .click();
  const modal = page.getByRole("dialog");
  await expect(modal).toContainText(
    "Режим только для просмотра. Вход будет записан в журнал",
  );
  await modal
    .getByLabel("Причина", { exact: true })
    .fill("Проверка обращения демо-ученика");
  await modal
    .getByRole("button", { name: "Открыть режим просмотра", exact: true })
    .click();
  await expect(page).toHaveURL(/\/cabinet$/);
  const banner = page.getByRole("complementary", {
    name: "Режим просмотра",
    exact: true,
  });
  await expect(banner).toContainText(f.student.name!);
  await expect(banner).toContainText("только просмотр");
  expect((await context.cookies()).find((c) => c.name === "sid")?.value).toBe(
    f.adminSid,
  );
  const modeCookie = (await context.cookies()).find(
    (c) => c.name === "impersonation",
  )!;
  expect(modeCookie.httpOnly).toBe(true);
  expect(modeCookie.sameSite).toBe("Strict");
  await page.evaluate(() => {
    localStorage.setItem("analytics-consent", "yes");
    sessionStorage.removeItem("pending-analytics-goals");
  });
  await page.goto(`/checkout/return?paymentId=${f.payment.id}`);
  await expect(
    page.getByRole("heading", { name: "Доступ открыт", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Перейти к обучению", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/subjects/${f.f.subject.slug}$`));
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("pending-analytics-goals"),
    ),
  ).toBeNull();
  expect(await page.locator("#metrika-script").count()).toBe(0);
  await page.goto(`/learn/${f.f.subject.slug}/${f.f.free.slug}`);
  const gap = lessonGap(page, 1);
  await gap.getByRole("combobox").selectOption({ label: "верный-один" });
  await gap.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Режим просмотра",
  );
  expect(await db.gapAnswer.count({ where: { userId: f.student.id } })).toBe(0);
  expect(await db.gapAttempt.count({ where: { userId: f.student.id } })).toBe(
    0,
  );
  expect(
    await db.topicProgress.count({ where: { userId: f.student.id } }),
  ).toBe(0);
  expect(
    await db.tutorMessage.findUnique({ where: { id: f.expiredMessage.id } }),
  ).toMatchObject({ status: "RUNNING" });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const box = await banner.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  const mainBox = await page.getByRole("main").boundingBox();
  expect(mainBox!.y).toBeGreaterThanOrEqual(box!.y + box!.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await mkdir("tmp/screenshots", { recursive: true });
  await page.screenshot({
    path: `tmp/screenshots/impersonation-${info.project.name}.png`,
    fullPage: true,
  });
  await banner.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/users/${f.student.id}$`));
  await expect(banner).toHaveCount(0);
  const history = page.getByRole("region", {
    name: "Просмотры администратором",
    exact: true,
  });
  await expect(history).toContainText("Проверка обращения демо-ученика");
  await expect(history).toContainText("Выход из режима");
  expect((await context.cookies()).find((c) => c.name === "sid")?.value).toBe(
    f.adminSid,
  );
  expect(
    (await context.cookies()).find((c) => c.name === "impersonation"),
  ).toBeUndefined();
  expect(
    await db.securityAudit.count({
      where: { actorId: f.admin.id, action: "IMPERSONATION_STARTED" },
    }),
  ).toBe(1);
  expect(
    await db.securityAudit.count({
      where: { actorId: f.admin.id, action: "IMPERSONATION_ENDED" },
    }),
  ).toBe(1);
});
test("teacher viewing keeps subject permissions and blocks editor autosave, profile and subscription writes", async ({
  page,
  context,
}) => {
  await page.goto(`/admin/users/${f.teacher.id}`);
  await page
    .getByRole("button", {
      name: "Посмотреть как этот пользователь",
      exact: true,
    })
    .click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Причина", { exact: true })
    .fill("Проверка кабинета преподавателя");
  await modal
    .getByRole("button", { name: "Открыть режим просмотра", exact: true })
    .click();
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(
    page.getByRole("heading", { name: "Учебный стенд", exact: true }),
  ).toBeVisible();
  await page.goto(`/admin/topics/${f.f.free.id}`);
  await expect(
    page.getByRole("complementary", { name: "Режим просмотра", exact: true }),
  ).toBeVisible();
  const before = await db.topic.findUnique({ where: { id: f.f.free.id } });
  for (const path of [
    `/api/admin/content/topics/${f.f.free.id}`,
    "/api/profile",
    "/api/checkout",
    "/api/auth/logout",
  ]) {
    const response = await context.request.fetch(path, {
      method: path.includes("/content/") ? "PATCH" : "POST",
      headers: { origin: "http://localhost:3100" },
      data: {},
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error).toContain("Режим просмотра");
  }
  expect(await db.topic.findUnique({ where: { id: f.f.free.id } })).toEqual(
    before,
  );
  await page
    .getByRole("complementary", { name: "Режим просмотра", exact: true })
    .getByRole("button", { name: "Выйти", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/admin/users/${f.teacher.id}$`));
  await expect(
    page.getByRole("region", {
      name: "Просмотры администратором",
      exact: true,
    }),
  ).toContainText("Проверка кабинета преподавателя");
});
