import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { getDb } from "../../lib/db";
import { getEnv } from "../../lib/env";
import { createStorageDriver } from "../../lib/storage";
import { currentLegal } from "../../lib/auth/legal";
import { newToken, hashToken } from "../../lib/auth/crypto";
import { ensureDentalDemo } from "../../scripts/preview/dental-demo";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
const db = getDb(),
  origin = "http://localhost:3100",
  users: string[] = [],
  contexts: BrowserContext[] = [];
test.setTimeout(90000);
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
    where: { topic: { subjectId: f.subject.id } },
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
test("publication names invalid fields, focuses them and succeeds after correction", async ({
  page,
}, info) => {
  await page.goto(`/admin/topics/${f.free.id}`);
  const title = page.getByRole("textbox", { name: "Название", exact: true }),
    slug = page.getByRole("textbox", { name: "Slug", exact: true }),
    minutes = page.getByRole("spinbutton", {
      name: "Время чтения, мин.",
      exact: true,
    });
  await title.fill("");
  await slug.fill("Неправильный адрес");
  await minutes.fill("0");
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Исправьте указанные поля" });
  await expect(alert.getByRole("link", { name: /^Название:/ })).toBeVisible();
  await expect(
    alert.getByRole("link", { name: /^Время чтения, мин\.:/ }),
  ).toContainText("не меньше 1");
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(slug).toHaveAttribute("aria-invalid", "true");
  await alert.getByRole("link", { name: /^Адрес урока \(Slug\):/ }).click();
  await expect(slug).toBeFocused();
  await page.screenshot({
    path: `tmp/screenshots/publication-field-errors-${info.project.name}.png`,
  });
  await title.fill("Исправленный урок");
  await slug.fill("corrected-lesson");
  await minutes.fill("5");
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } })).title,
    )
    .toBe("Исправленный урок");
  await expect(title).not.toHaveAttribute("aria-invalid", "true");
  await expect(alert).not.toBeVisible();
  await page
    .getByRole("checkbox", { name: "Проверено экспертом", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Отправить на проверку", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } })).status,
    )
    .toBe("REVIEW");
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(
    page.getByText("Материал опубликован", { exact: true }),
  ).toBeVisible();
});
test("publication identifies an invalid saved question and opens its editor for repair", async ({
  page,
}) => {
  const q = f.free.question_topicId.find((question) => question.order === 1)!;
  await db.question.update({ where: { id: q.id }, data: { explanation: "" } });
  await db.topic.update({
    where: { id: f.free.id },
    data: { status: "REVIEW" },
  });
  await page.goto(`/admin/topics/${f.free.id}`);
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Исправьте указанные поля" });
  await alert
    .getByRole("link", { name: /^Вопрос 2 — Объяснение ответа:/ })
    .click();
  const form = page.locator("#lesson-question-form");
  await expect(
    form.getByRole("textbox", { name: "Текст вопроса", exact: true }),
  ).toHaveValue(q.stem);
  const explanation = form.getByRole("textbox", {
    name: "Объяснение после проверки",
    exact: true,
  });
  await expect(explanation).toBeFocused();
  await explanation.fill("Исправленное объяснение синтетического задания.");
  await form
    .getByRole("button", { name: "Сохранить вопрос", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.question.findUniqueOrThrow({ where: { id: q.id } }))
          .explanation,
    )
    .toBe("Исправленное объяснение синтетического задания.");
  await page
    .getByRole("checkbox", { name: "Проверено экспертом", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Отправить на проверку", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } })).status,
    )
    .toBe("REVIEW");
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(
    page.getByText("Материал опубликован", { exact: true }),
  ).toBeVisible();
});
test("table controls expand, merge, split and preserve spans after reload and student preview", async ({
  page,
}, info) => {
  await page.goto(`/admin/topics/${f.free.id}`);
  const editor = page.getByRole("textbox", {
    name: "Текст методички",
    exact: true,
  });
  await editor.fill("Материал до таблицы.");
  await editor.press("End");
  await editor.press("Enter");
  await page
    .getByRole("button", { name: "Вставить таблицу", exact: true })
    .click();
  const table = editor.locator("table");
  await expect(table.locator("tr")).toHaveCount(3);
  await table.locator("th").first().click();
  await page
    .getByRole("button", { name: "Столбец справа", exact: true })
    .click();
  await expect(table.locator("tr").first().locator("th,td")).toHaveCount(3);
  await page.getByRole("button", { name: "Строка ниже", exact: true }).click();
  await expect(table.locator("tr")).toHaveCount(4);
  const body = table.locator("tr").nth(1);
  await body.locator("td").nth(0).click();
  await page.keyboard.type("Общая ячейка");
  await body
    .locator("td")
    .nth(1)
    .click({ modifiers: ["Shift"] });
  await page
    .getByRole("button", { name: "Объединить ячейки", exact: true })
    .click();
  await expect(body.locator('td[colspan="2"]')).toContainText("Общая ячейка");
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } }))
          .contentMd,
    )
    .toContain("<!-- emal-table:v1");
  await page.reload();
  await expect(table.locator('td[colspan="2"]')).toContainText("Общая ячейка");
  await table.locator('td[colspan="2"]').click();
  await page
    .getByRole("button", { name: "Разделить ячейку", exact: true })
    .click();
  await expect(body.locator("td")).toHaveCount(3);
  await table.locator("th").first().click();
  await body
    .locator("td")
    .first()
    .click({ modifiers: ["Shift"] });
  await page
    .getByRole("button", { name: "Объединить ячейки", exact: true })
    .click();
  await expect(table.locator('[rowspan="2"]')).toContainText("Общая ячейка");
  await page
    .getByRole("button", { name: "Открыть как ученик", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/topics/${f.free.id}/student-preview$`),
  );
  await expect(page.locator('[rowspan="2"]')).toContainText("Общая ячейка");
  await expect(page.locator(".student-preview-material thead")).toHaveCount(0);
  await page
    .getByRole("link", { name: "Вернуться в редактор", exact: true })
    .click();
  await table.locator('[rowspan="2"]').click();
  await page
    .getByRole("button", { name: "Разделить ячейку", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Удалить столбец", exact: true })
    .click();
  await expect(table.locator("tr").first().locator("th,td")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Удалить строку", exact: true })
    .click();
  await expect(table.locator("tr")).toHaveCount(3);
  await page.screenshot({
    path: `tmp/screenshots/table-controls-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Удалить таблицу", exact: true })
    .click();
  await expect(table).toHaveCount(0);
});
test("images insert between text blocks, move in both directions and can be removed and restored", async ({
  page,
}, info) => {
  await page.goto(`/admin/topics/${f.free.id}`);
  const editor = page.getByRole("textbox", {
    name: "Текст методички",
    exact: true,
  });
  await editor.fill("Первый абзац.");
  await editor.press("End");
  await editor.press("Enter");
  await page.keyboard.type("Последний абзац.");
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page
    .getByRole("button", { name: "Вставить изображение", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Изображение в уроке",
    exact: true,
  });
  await dialog
    .getByLabel("Файл изображения", { exact: true })
    .setInputFiles({ name: "scheme.png", mimeType: "image/png", buffer: png });
  await dialog
    .getByRole("textbox", { name: "Описание под изображением", exact: true })
    .fill("Схема между абзацами");
  await dialog
    .getByRole("button", { name: "Загрузить и вставить", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const img = editor.getByRole("img", {
    name: "Схема между абзацами",
    exact: true,
  });
  await expect(img).toBeVisible();
  await img.click();
  const index = () =>
    editor.evaluate((el) =>
      Array.from(el.children).findIndex((n) => n.tagName === "IMG"),
    );
  const before = await index();
  expect(before).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Переместить блок ниже", exact: true })
    .click();
  await expect.poll(index).toBe(before + 1);
  await page
    .getByRole("button", { name: "Переместить блок выше", exact: true })
    .click();
  await expect.poll(index).toBe(before);
  await page
    .getByRole("button", { name: "Текст после изображения", exact: true })
    .click();
  await page.keyboard.type("Добавленный абзац после схемы.");
  await expect(editor).toContainText("Добавленный абзац после схемы.");
  await img.click();
  await page
    .getByRole("button", { name: "Удалить изображение", exact: true })
    .click();
  await expect(img).toHaveCount(0);
  await page
    .getByRole("button", { name: "Отменить действие", exact: true })
    .click();
  await expect(img).toBeVisible();
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect
    .poll(async () => {
      const saved = await db.topic.findUniqueOrThrow({
        where: { id: f.free.id },
      });
      return (
        saved.contentMd.includes("Добавленный абзац после схемы.") &&
        saved.contentMd.includes("/api/content-images/")
      );
    })
    .toBe(true);
  await page.reload();
  await expect(img).toBeVisible();
  await expect(editor).toContainText("Добавленный абзац после схемы.");
  await img.click();
  await page.screenshot({
    path: `tmp/screenshots/image-blocks-${info.project.name}.png`,
    fullPage: true,
  });
});
test("content tree exposes the dental draft and interactive student preview without publishing or overwriting it", async ({
  page,
  browser,
}, info) => {
  const demo = await ensureDentalDemo({
    subjectId: f.subject.id,
    sectionId: f.free.sectionId!,
  });
  expect(demo.status).toBe("DRAFT");
  expect(demo.needsExpertReview).toBe(true);
  await page.goto(`/admin?q=${encodeURIComponent(f.subject.title)}`);
  const tree = page.getByRole("navigation", {
    name: "Предметы, разделы и уроки",
    exact: true,
  });
  await expect(
    tree.getByRole("link", { name: demo.title, exact: true }),
  ).toBeVisible();
  await expect(
    tree.getByText("Раздел проверки", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `tmp/screenshots/content-tree-${info.project.name}.png`,
    fullPage: true,
  });
  await tree.getByRole("link", { name: demo.title, exact: true }).click();
  await page
    .getByRole("button", { name: "Открыть как ученик", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(demo.title);
  const images = page.locator(".student-preview-material img");
  await expect(images).toHaveCount(2);
  for (const img of await images.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }
  await expect(page.locator(".student-preview-material select")).toHaveCount(9);
  const written = page
    .locator(".student-preview-material")
    .getByRole("textbox");
  await written.fill("36");
  const quiz = page.locator(".student-preview-test");
  await expect(quiz.getByRole("checkbox")).toHaveCount(9);
  await expect(quiz.getByRole("textbox")).toHaveCount(1);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: `tmp/screenshots/dental-student-${info.project.name}.png`,
    fullPage: true,
  });
  const pupil = await browser.newContext({ baseURL: origin });
  contexts.push(pupil);
  await signIn(pupil, student);
  expect(
    (
      await pupil.request.get(`/admin/topics/${demo.id}/student-preview`)
    ).status(),
  ).toBe(403);
  expect(
    (await pupil.request.get(`/learn/${f.subject.slug}/${demo.slug}`)).status(),
  ).toBe(404);
  const staff = await browser.newContext({ baseURL: origin });
  contexts.push(staff);
  await signIn(staff, teacher);
  expect(
    (
      await staff.request.get(`/admin/topics/${demo.id}/student-preview`)
    ).status(),
  ).toBe(200);
  await db.teacherSubject.deleteMany({
    where: { teacherId: teacher, subjectId: f.subject.id },
  });
  expect(
    (
      await staff.request.get(`/admin/topics/${demo.id}/student-preview`)
    ).status(),
  ).toBe(404);
  await db.topic.update({
    where: { id: demo.id },
    data: { title: "Сохранённая правка автора" },
  });
  const again = await ensureDentalDemo({
    subjectId: f.subject.id,
    sectionId: f.free.sectionId!,
  });
  expect(again.id).toBe(demo.id);
  expect(again.title).toBe("Сохранённая правка автора");
  expect(await db.topicImage.count({ where: { topicId: demo.id } })).toBe(2);
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

test("visual author formats a selection and creates a dropdown gap without Markdown", async ({
  page,
}) => {
  await page.goto(`/admin/topics/${f.free.id}`);
  const editor = page.getByRole("textbox", {
    name: "Текст методички",
    exact: true,
  });
  await editor.fill("Выделяем слово для задания.");
  const heading = page.getByRole("button", { name: "Заголовок", exact: true });
  if ((await heading.getAttribute("aria-pressed")) === "true")
    await heading.click();
  async function select(word: string) {
    await editor.evaluate((element, word) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const at = node.textContent?.indexOf(word) ?? -1;
        if (at >= 0) {
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + word.length);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          break;
        }
      }
    }, word);
  }
  await select("Выделяем");
  await page.getByRole("button", { name: "Жирный", exact: true }).click();
  await expect(editor.locator("strong")).toHaveText("Выделяем");
  await select("Выделяем");
  await page.getByRole("button", { name: "Курсив", exact: true }).click();
  await select("Выделяем");
  await page.getByRole("button", { name: "Подчёркнутый", exact: true }).click();
  await expect(editor.locator("u")).toHaveText("Выделяем");
  await page.getByRole("button", { name: "Заголовок", exact: true }).click();
  await expect(editor.locator("h2")).toBeVisible();
  await select("слово");
  await page.getByRole("button", { name: "Пропуск", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Настройка пропуска",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Вариант 2", exact: true })
    .fill("другое");
  await dialog
    .getByRole("textbox", { name: "Объяснение после проверки", exact: true })
    .fill("Проверка выбранного слова.");
  await dialog
    .getByRole("button", { name: "Сохранить пропуск", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(editor.locator(".rich-gap-token")).toContainText("слово");
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } }))
          .contentMd,
    )
    .toContain("[[слово|другое]]");
  await page.screenshot({
    path: `tmp/screenshots/visual-editor-${page.viewportSize()!.width}.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(editor.locator("u")).toHaveText("Выделяем");
  await expect(editor.locator(".rich-gap-token")).toContainText("слово");
  await editor.locator(".rich-gap-token").click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "Вариант 2", exact: true })
    .fill("иной");
  await dialog
    .getByRole("button", { name: "Сохранить пропуск", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } }))
          .contentMd,
    )
    .toContain("[[слово|иной]]");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("gap buttons open the matching saved choices by click or keyboard and cancellation keeps the text", async ({
  page,
}) => {
  await page.goto(`/admin/topics/${f.free.id}`);
  const editor = page.getByRole("textbox", {
    name: "Текст методички",
    exact: true,
  });
  const first = editor.getByRole("button", {
    name: "Изменить пропуск «верный-один»",
    exact: true,
  });
  const second = editor.getByRole("button", {
    name: "Изменить пропуск «верный-два»",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "Настройка пропуска",
    exact: true,
  });
  const initialRow = await db.topic.findUniqueOrThrow({
    where: { id: f.free.id },
  });
  await first.click();
  await expect(
    dialog.getByRole("textbox", { name: "Вариант 1", exact: true }),
  ).toHaveValue("верный-один");
  await dialog
    .getByRole("textbox", { name: "Вариант 2", exact: true })
    .fill("Не сохранять");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("#lesson-editor-status")).toHaveText("Сохранено");
  const afterCancel = await db.topic.findUniqueOrThrow({
    where: { id: f.free.id },
  });
  expect(afterCancel.contentMd).toBe(initialRow.contentMd);
  expect(afterCancel.editRevision).toBe(initialRow.editRevision);
  expect(afterCancel.status).toBe("PUBLISHED");
  expect(afterCancel.needsExpertReview).toBe(false);
  await first.click();
  await dialog
    .getByRole("combobox", { name: "Тип задания", exact: true })
    .selectOption("MULTIPLE_CHOICE");
  await dialog.getByRole("checkbox", { name: "2", exact: true }).check();
  await dialog
    .getByRole("textbox", { name: "Объяснение после проверки", exact: true })
    .fill("Проверка первого задания.");
  await dialog
    .getByRole("button", { name: "Сохранить пропуск", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await second.focus();
  await second.press("Enter");
  await expect(
    dialog.getByRole("textbox", { name: "Вариант 1", exact: true }),
  ).toHaveValue("верный-два");
  await expect(
    dialog.getByRole("textbox", {
      name: "Объяснение после проверки",
      exact: true,
    }),
  ).toHaveValue("");
  await dialog
    .getByRole("textbox", { name: "Вариант 2", exact: true })
    .fill("Ещё вариант");
  await dialog
    .getByRole("button", { name: "Сохранить пропуск", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } }))
          .contentMd,
    )
    .toContain("[[верный-два|Ещё вариант]]");
  await page.reload();
  await first.click();
  await expect(
    dialog.getByRole("combobox", { name: "Тип задания", exact: true }),
  ).toHaveValue("MULTIPLE_CHOICE");
  await expect(
    dialog.getByRole("checkbox", { name: "2", exact: true }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("textbox", {
      name: "Объяснение после проверки",
      exact: true,
    }),
  ).toHaveValue("Проверка первого задания.");
  const saved = (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } }))
    .contentMd;
  await dialog
    .getByRole("textbox", { name: "Вариант 1", exact: true })
    .fill("Несохранённое значение");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(
    (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } })).contentMd,
  ).toBe(saved);
  await second.focus();
  await second.press("Space");
  await expect(
    dialog.getByRole("textbox", { name: "Вариант 2", exact: true }),
  ).toHaveValue("Ещё вариант");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", {
      name: "Исходный текст — для переноса материалов",
      exact: true,
    })
    .click();
  await expect(first).toBeDisabled();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "3. Задания в методичке", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Этапы создания урока", exact: true })
      .getByRole("link", { name: "3. Тест", exact: true }),
  ).toBeVisible();
});

test("teacher creates sections and lessons inside the book and switching flushes the current draft", async ({
  page,
  context,
}) => {
  await signIn(context, teacher);
  await page.goto(`/admin/topics/${f.free.id}`);
  await page
    .getByRole("textbox", { name: "Название", exact: true })
    .fill("Черновик перед переключением");
  const tree = page.getByRole("navigation", {
    name: "Разделы и уроки",
    exact: true,
  });
  await tree.getByRole("link", { name: new RegExp(f.paid.title) }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    f.paid.title,
  );
  expect(
    (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } })).title,
  ).toBe("Черновик перед переключением");
  await tree
    .getByRole("link", { name: /Черновик перед переключением/ })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Название", exact: true }),
  ).toHaveValue("Черновик перед переключением");
  await page
    .getByRole("button", { name: "+ Новый раздел", exact: true })
    .click();
  const section = page.getByRole("form", { name: "Новый раздел", exact: true });
  await section
    .getByRole("textbox", { name: "Название раздела", exact: true })
    .fill("Раздел из книги");
  await section
    .getByRole("button", { name: "Добавить раздел", exact: true })
    .click();
  const lesson = page.getByRole("form", { name: "Новый урок", exact: true });
  await expect(
    lesson
      .getByRole("combobox", { name: "Раздел для урока", exact: true })
      .locator("option:checked"),
  ).toHaveText("Раздел из книги");
  await lesson
    .getByRole("textbox", { name: "Название урока", exact: true })
    .fill("Урок из книги");
  await lesson
    .getByRole("button", { name: "Создать урок", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Урок из книги",
  );
  const created = await db.topic.findFirstOrThrow({
    where: { subjectId: f.subject.id, title: "Урок из книги" },
    include: { section: true },
  });
  expect(created.section?.title).toBe("Раздел из книги");
  expect(created.status).toBe("DRAFT");
  await expect(page).toHaveURL(new RegExp(`/admin/topics/${created.id}$`));
  await expect(
    page.getByRole("heading", { name: "Как увидит студент", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Перед публикацией", exact: true }),
  ).toBeVisible();
  expect(
    (
      await context.request.get(`/admin/subjects/${f.subject.id}/editor`)
    ).status(),
  ).toBe(200);
  await page.screenshot({
    path: `tmp/screenshots/lesson-book-${page.viewportSize()!.width}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
});
