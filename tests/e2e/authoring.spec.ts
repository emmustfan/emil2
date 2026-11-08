import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { getDb } from "../../lib/db";
import { getEnv } from "../../lib/env";
import { createStorageDriver } from "../../lib/storage";
import { currentLegal } from "../../lib/auth/legal";
import { newToken, hashToken } from "../../lib/auth/crypto";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
const db = getDb(),
  origin = "http://localhost:3100",
  users: string[] = [],
  contexts: BrowserContext[] = [];
let f: LessonFixture,
  admin: string,
  teacher: string,
  student: string,
  png: Buffer;
test.setTimeout(90000);
async function user(role: "ADMIN" | "EDITOR" | "USER") {
  const docs = await currentLegal(),
    u = await db.user.create({
      data: {
        email: `authoring-browser-${randomUUID()}@example.test`,
        emailVerifiedAt: new Date(),
        name: "Проверка автора",
        role,
        consentPdAt: new Date(),
        consentPdVersion: docs.consent.version,
        offerVersion: docs.offer.version,
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
test.beforeEach(async ({ context }) => {
  f = await createLessonFixture("authoring-browser");
  admin = await user("ADMIN");
  teacher = await user("EDITOR");
  student = await user("USER");
  await db.teacherSubject.create({
    data: { teacherId: teacher, subjectId: f.subject.id, assignedById: admin },
  });
  png = await sharp({
    create: { width: 80, height: 40, channels: 3, background: "#08634f" },
  })
    .png()
    .toBuffer();
  await signIn(context, admin);
});
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  const images = await db.topicImage.findMany({
    where: { topicId: { in: [f.free.id, f.paid.id] } },
    select: { storageKey: true },
  });
  await db.teacherSubject.deleteMany({
    where: {
      OR: [{ teacherId: { in: users } }, { assignedById: { in: users } }],
    },
  });
  await cleanupLessonFixture(f, [], users.splice(0));
  for (const image of images)
    await createStorageDriver(getEnv()).remove(image.storageKey);
});
test.afterAll(async () => {
  await db.$disconnect();
});
test("author follows editor steps, uploads an image, reviews and publishes a lesson visible to a guest", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto(`/admin/topics/${f.free.id}`);
  await expect(
    page.getByRole("navigation", { name: "Этапы создания урока" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Готовность к публикации", exact: true }),
  ).toBeVisible();
  await page.getByText("Добавить изображение", { exact: true }).click();
  await page
    .getByLabel("Файл изображения", { exact: true })
    .setInputFiles({ name: "scheme.png", mimeType: "image/png", buffer: png });
  await page
    .getByRole("textbox", { name: "Описание под изображением", exact: true })
    .fill("Учебная схема для проверки редактора");
  await page
    .getByRole("button", { name: "Загрузить и вставить", exact: true })
    .click();
  const preview = page.getByRole("region", {
      name: "Предпросмотр",
      exact: true,
    }),
    image = preview.getByRole("img", {
      name: "Учебная схема для проверки редактора",
      exact: true,
    });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page
    .getByRole("checkbox", { name: "Проверено экспертом", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Отправить на проверку", exact: true })
    .click();
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } })).status,
    )
    .toBe("PUBLISHED");
  await page.getByText("Помощь ИИ при проверке урока", { exact: true }).click();
  const prompt = await page
    .getByRole("textbox", { name: "Запрос для проверки", exact: true })
    .inputValue();
  expect(prompt).toContain("МЕТОДИЧКА");
  expect(prompt).not.toContain("/api/content-images/");
  expect(prompt).toContain("не разрешаешь публикацию");
  await mkdir("tmp/screenshots", { recursive: true });
  await page.screenshot({
    path: `tmp/screenshots/authoring-editor-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const guest = await browser.newContext({
    baseURL: origin,
    viewport: testInfo.project.use.viewport,
  });
  contexts.push(guest);
  const learn = await guest.newPage();
  await learn.goto(`/learn/${f.subject.slug}/${f.free.slug}`);
  const shown = learn.getByRole("img", {
    name: "Учебная схема для проверки редактора",
    exact: true,
  });
  await expect(shown).toBeVisible();
  await expect
    .poll(() =>
      shown.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  const src = await shown.getAttribute("src"),
    response = await guest.request.get(src!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/webp");
  expect(response.headers()["cache-control"]).toContain("no-store");
});
test("integration instructions hide secrets and remain admin-only; image upload rejects student and foreign origin", async ({
  page,
  context,
  browser,
}) => {
  await page.goto("/admin/integrations");
  await expect(
    page.getByRole("heading", { name: "Подключение сервисов", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Тестовая модель без внешних запросов", { exact: true }),
  ).toBeVisible();
  expect(await page.content()).not.toContain(
    "123456:fixture-only-not-a-real-key",
  );
  const staff = await browser.newContext({ baseURL: origin });
  contexts.push(staff);
  await signIn(staff, teacher);
  expect((await staff.request.get("/admin/integrations")).status()).toBe(403);
  expect(
    (
      await context.request.post(
        `/api/admin/content/topics/${f.free.id}/images`,
        {
          headers: { Origin: "https://other.invalid" },
          multipart: {
            file: { name: "scheme.png", mimeType: "image/png", buffer: png },
          },
        },
      )
    ).status(),
  ).toBe(403);
  const learner = await browser.newContext({ baseURL: origin });
  contexts.push(learner);
  await signIn(learner, student);
  expect(
    (
      await learner.request.post(
        `/api/admin/content/topics/${f.free.id}/images`,
        {
          headers: { Origin: origin },
          multipart: {
            file: { name: "scheme.png", mimeType: "image/png", buffer: png },
          },
        },
      )
    ).status(),
  ).toBe(403);
});
