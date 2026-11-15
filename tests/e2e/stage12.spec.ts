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
const db = getDb(),
  users: string[] = [];
let f: LessonFixture, studentContext: BrowserContext;
test.setTimeout(90000);
async function signIn(context: BrowserContext, role: "ADMIN" | "USER") {
  const docs = await currentLegal(),
    token = newToken();
  const user = await db.user.create({
    data: {
      email: `stage12-${randomUUID()}@example.test`,
      name: role === "ADMIN" ? "Автор проверки" : "Студент проверки",
      role,
      emailVerifiedAt: new Date(),
      consentPdAt: new Date(),
      consentPdVersion: docs.consent.version,
      offerVersion: docs.offer.version,
      university: "Учебный стенд",
      course: 1,
    },
  });
  users.push(user.id);
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
}
test.beforeEach(async ({ context, browser }) => {
  f = await createLessonFixture("stage12-browser");
  await signIn(context, "ADMIN");
  studentContext = await browser.newContext();
  await signIn(studentContext, "USER");
});
test.afterEach(async () => {
  await studentContext.close();
  await cleanupLessonFixture(f, [], users.splice(0));
});
test.afterAll(async () => {
  await db.$disconnect();
});
test("author drafts while another browser learns; publication switches the version and history stays readonly", async ({
  page,
}, info) => {
  const student = await studentContext.newPage(),
    url = `/learn/${f.subject.slug}/${f.free.slug}`;
  await student.goto(`http://localhost:3100${url}`);
  await expect(
    student.getByRole("heading", { name: f.free.title, exact: true }),
  ).toBeVisible();
  await page.goto(`/admin/topics/${f.free.id}`);
  await page
    .getByRole("textbox", { name: "Название", exact: true })
    .fill("Новая опубликованная версия");
  await page
    .getByRole("button", {
      name: "Исходный текст — для переноса материалов",
      exact: true,
    })
    .click();
  const source = page.getByRole("textbox", {
    name: "Текст методички (Markdown)",
    exact: true,
  });
  await source.fill(
    (await source.inputValue()) + "\n\nТЕКСТ_ТОЛЬКО_ПОСЛЕ_ПУБЛИКАЦИИ.",
  );
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect(
    page
      .getByRole("note")
      .filter({ hasText: "Есть неопубликованные изменения" }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } }))
          .draftState,
    )
    .toBe("DRAFT");
  await student.reload();
  await expect(
    student.getByRole("heading", { name: f.free.title, exact: true }),
  ).toBeVisible();
  await expect(student.locator("body")).not.toContainText(
    "ТЕКСТ_ТОЛЬКО_ПОСЛЕ_ПУБЛИКАЦИИ",
  );
  await page.getByText("Сравнить с опубликованной", { exact: true }).click();
  await expect(
    page.getByLabel("Сравнение текста", { exact: true }),
  ).toContainText("+ ТЕКСТ_ТОЛЬКО_ПОСЛЕ_ПУБЛИКАЦИИ");
  const preview = await page.context().newPage();
  await preview.goto(`/admin/topics/${f.free.id}/student-preview`);
  await expect(preview.locator("body")).toContainText(
    "ТЕКСТ_ТОЛЬКО_ПОСЛЕ_ПУБЛИКАЦИИ",
  );
  await preview.close();
  await page
    .getByRole("checkbox", { name: "Проверено экспертом", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Отправить на проверку", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } }))
          .draftState,
    )
    .toBe("REVIEW");
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } }))
          .version,
    )
    .toBe(2);
  await student.reload();
  await expect(student.locator("body")).toContainText(
    "ТЕКСТ_ТОЛЬКО_ПОСЛЕ_ПУБЛИКАЦИИ",
  );
  await expect(
    student.getByRole("heading", {
      name: "Новая опубликованная версия",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("История публикаций", { exact: true }).click();
  await page
    .getByRole("button", { name: "Смотреть версию 2", exact: true })
    .click();
  const snapshot = page.getByRole("article", {
    name: "Снимок версии 2",
    exact: true,
  });
  await expect(snapshot).toContainText("ТЕКСТ_ТОЛЬКО_ПОСЛЕ_ПУБЛИКАЦИИ");
  await expect(snapshot.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({
    path: `tmp/screenshots/stage12-history-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: "Название", exact: true })
    .fill("Отменяемые правки");
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Отменить изменения", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Название", exact: true }),
  ).toHaveValue("Новая опубликованная версия");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Снять с публикации", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } })).status,
    )
    .toBe("DRAFT");
  const hidden = await student.goto(`http://localhost:3100${url}`);
  expect(hidden?.status()).toBe(404);
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } }))
          .version,
    )
    .toBe(3);
  const visible = await student.goto(`http://localhost:3100${url}`);
  expect(visible?.status()).toBe(200);
});
