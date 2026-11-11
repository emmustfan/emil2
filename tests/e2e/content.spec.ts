import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db";
import { newToken, hashToken } from "../../lib/auth/crypto";
import type { TopicDTO, SubjectDTO, SectionDTO } from "../../lib/content/types";
const db = getDb(),
  origin = "http://localhost:3100";
let userId: string | undefined;
let prefix: string;
const subjectIds: string[] = [];
test.setTimeout(90000);
const md = () =>
  `## Проверка\n\n${Array.from({ length: 10 }, (_, i) => `Фрагмент ${i} [[ответ-${i}|ошибка-${i}]].`).join("\n\n")}`;
function topicInput(subjectId: string, contentMd = md()) {
  return {
    subjectId,
    title: "Синтетическая тема",
    slug: `topic-${randomUUID()}`,
    sectionId: null,
    order: 0,
    isFree: true,
    contentMd,
    readingMinutes: 5,
    authorName: "Автор фикстуры",
    reviewerName: "Рецензент фикстуры",
    referencesMd: "Синтетический пример, не медицинский материал.",
    reviewed: false,
  };
}
async function api<T>(
  request: APIRequestContext,
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const response = await request.fetch(`/api/admin/content/${path}`, {
    method,
    data: body,
    headers: { Origin: origin },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}
async function fixture(request: APIRequestContext, contentMd = md()) {
  const s = await api<SubjectDTO>(request, "subjects", "POST", {
    title: prefix,
    slug: prefix,
    shortDescription: "Синтетическая проверка редактора",
    descriptionMd: null,
    courses: [1],
    order: 0,
    status: "PUBLISHED",
    seoTitle: null,
    seoDescription: null,
  });
  subjectIds.push(s.id);
  const topic = await api<TopicDTO>(
    request,
    "topics",
    "POST",
    topicInput(s.id, contentMd),
  );
  return { s, topic };
}
function fields(row: TopicDTO) {
  return {
    title: row.title,
    slug: row.slug,
    sectionId: row.sectionId,
    order: row.order,
    isFree: row.isFree,
    contentMd: row.contentMd,
    readingMinutes: row.readingMinutes,
    authorName: row.authorName,
    reviewerName: row.reviewerName,
    referencesMd: row.referencesMd,
    reviewed: !row.needsExpertReview,
  };
}
async function fillQuestion(page: Page, index: number) {
  const form = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Новый вопрос", exact: true }),
  });
  await form
    .getByRole("textbox", { name: "Текст вопроса", exact: true })
    .fill(`Вопрос фикстуры ${index}`);
  for (let i = 1; i <= 3; i++)
    await form
      .getByRole("textbox", { name: `Вариант ${i}`, exact: true })
      .fill(`Ответ ${index}-${i}`);
  await form.getByRole("radio", { name: "2", exact: true }).check();
  await form
    .getByRole("textbox", { name: "Объяснение после проверки", exact: true })
    .fill("Тестовое объяснение без медицинских утверждений.");
  await form
    .getByRole("spinbutton", { name: "Порядок", exact: true })
    .fill(String(index));
  await form
    .getByRole("button", { name: "Сохранить вопрос", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: `Вопрос фикстуры ${index}`,
      exact: true,
    }),
  ).toBeVisible();
}
async function fiveQuestions(request: APIRequestContext, row: TopicDTO) {
  for (let i = 0; i < 5; i++)
    row = await api<TopicDTO>(request, `topics/${row.id}/questions`, "POST", {
      topicRevision: row.editRevision,
      stem: `Фикстура ${i}`,
      options: [
        { id: "a", text: "Да" },
        { id: "b", text: "Нет" },
        { id: "c", text: "Иное" },
      ],
      correctOptionIds: ["b"],
      explanation: "Синтетический пример",
      sourceBlockKey: null,
      isDiagnostic: false,
      order: i,
    });
  return row;
}
test.beforeEach(async ({ context }) => {
  userId = undefined;
  prefix = `editor-${randomUUID()}`;
  const documents = await db.legalDocument.findMany({
    where: {
      kind: { in: ["consent", "oferta"] },
      publishedAt: { lte: new Date() },
    },
    orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
  });
  const user = await db.user.create({
    data: {
      email: `${prefix}@example.test`,
      role: "ADMIN",
      name: "Редактор фикстуры",
      consentPdAt: new Date(),
      consentPdVersion: documents.find((d) => d.kind === "consent")!.version,
      offerVersion: documents.find((d) => d.kind === "oferta")!.version,
    },
  });
  userId = user.id;
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
  await Promise.all(context.pages().map((page) => page.close()));
  const subjects = await db.subject.findMany({
    where: {
      OR: [{ id: { in: subjectIds } }, { slug: { startsWith: prefix } }],
    },
    select: { id: true },
  });
  const ids = subjects.map((s) => s.id);
  const topics = await db.topic.findMany({
    where: { subjectId: { in: ids } },
    select: { id: true },
  });
  const topicIds = topics.map((t) => t.id);
  for (const topicId of topicIds)
    await db.$executeRaw`DELETE FROM pgboss.job WHERE name='content-index' AND data->>'topicId'=${topicId}`;
  await db.contentChunk.deleteMany({ where: { topicId: { in: topicIds } } });
  await db.question.deleteMany({ where: { topicId: { in: topicIds } } });
  await db.gap.deleteMany({ where: { topicId: { in: topicIds } } });
  await db.topic.deleteMany({ where: { id: { in: topicIds } } });
  await db.section.deleteMany({ where: { subjectId: { in: ids } } });
  await db.subject.deleteMany({ where: { id: { in: ids } } });
  if (userId) {
    await db.session.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  }
  subjectIds.length = 0;
});
test.afterAll(async () => {
  await db.$disconnect();
});

test("administrator creates a subject, section, ten gaps, five questions and publishes with stable IDs", async ({
  page,
}) => {
  await page.goto("/admin");
  await page
    .getByRole("link", { name: "Добавить предмет", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Название", exact: true })
    .fill("Редактор: проверка публикации");
  await page.getByRole("textbox", { name: "Slug", exact: true }).fill(prefix);
  await page
    .getByRole("textbox", { name: "Краткое описание", exact: true })
    .fill("Синтетическая проверка интерфейса редактора.");
  await page
    .getByRole("combobox", { name: "Статус", exact: true })
    .selectOption("PUBLISHED");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/subjects\/[^/]+$/);
  const subjectId = page.url().split("/").at(-1)!;
  subjectIds.push(subjectId);
  await page
    .getByRole("link", {
      name: "Открыть книгу и редактор уроков →",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "+ Новый раздел", exact: true })
    .click();
  const sectionArea = page.getByRole("form", {
    name: "Новый раздел",
    exact: true,
  });
  await sectionArea
    .getByRole("textbox", { name: "Название раздела", exact: true })
    .fill("Раздел фикстуры");
  await sectionArea
    .getByRole("button", { name: "Добавить раздел", exact: true })
    .click();
  const lessonForm = page.getByRole("form", {
    name: "Новый урок",
    exact: true,
  });
  await lessonForm
    .getByRole("textbox", { name: "Название урока", exact: true })
    .fill("Методичка фикстуры");
  await lessonForm
    .getByRole("combobox", { name: "Раздел для урока", exact: true })
    .selectOption({ label: "Раздел фикстуры" });
  await lessonForm
    .getByRole("button", { name: "Создать урок", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/topics\/[^/]+$/);
  const topicId = page.url().split("/").at(-1)!;
  await page
    .getByText("Исходный текст — для переноса материалов", { exact: true })
    .click();
  const textarea = page.getByRole("textbox", {
    name: "Текст методички (Markdown)",
    exact: true,
  });
  await textarea.fill(md());
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: topicId } }))
          .contentMd,
    )
    .toBe(md());
  const preview = page.getByRole("region", {
    name: "Предпросмотр",
    exact: true,
  });
  await expect(preview.getByText(/Пропусков: 10/)).toBeVisible();
  const firstPreview = preview
    .locator("span[id^='exercise-markdown-']")
    .first();
  await firstPreview.getByRole("combobox").selectOption({ label: "ответ-0" });
  await firstPreview
    .getByRole("button", { name: "Проверить", exact: true })
    .click();
  await expect(firstPreview.getByRole("status")).toContainText("Верно");
  for (let i = 0; i < 5; i++) await fillQuestion(page, i);
  await page
    .getByRole("textbox", { name: "Автор", exact: true })
    .fill("Автор фикстуры");
  await page
    .getByRole("textbox", { name: "Рецензент", exact: true })
    .fill("Рецензент фикстуры");
  await page
    .getByRole("textbox", { name: "Источники (Markdown)", exact: true })
    .fill("Синтетический пример для проверки программного обеспечения.");
  await page
    .getByRole("checkbox", { name: "Проверено экспертом", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: topicId } }))
          .needsExpertReview,
    )
    .toBe(false);
  await page
    .getByRole("button", { name: "Отправить на проверку", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: topicId } })).status,
    )
    .toBe("REVIEW");
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(
    page.getByText("Материал опубликован", { exact: true }),
  ).toBeVisible();
  const before = await db.gap.findMany({
    where: { topicId },
    orderBy: { gapKey: "asc" },
  });
  expect(before).toHaveLength(10);
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: topicId } })).version,
    )
    .toBe(1);
  expect(
    (
      await db.gap.findMany({ where: { topicId }, orderBy: { gapKey: "asc" } })
    ).map((g) => g.id),
  ).toEqual(before.map((g) => g.id));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `tmp/screenshots/editor-stage-2-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("invalid gap reports its line, survives autosave and blocks publication until corrected", async ({
  page,
  context,
}) => {
  const invalid = "## Проверка\n\nОшибка [[ответ|]].";
  let { topic } = await fixture(context.request, invalid);
  topic = await fiveQuestions(context.request, topic);
  topic = await api<TopicDTO>(context.request, `topics/${topic.id}`, "PATCH", {
    ...fields(topic),
    reviewed: true,
    revision: topic.editRevision,
  });
  topic = await api<TopicDTO>(
    context.request,
    `topics/${topic.id}/status`,
    "POST",
    { revision: topic.editRevision, status: "REVIEW" },
  );
  await page.goto(`/admin/topics/${topic.id}`);
  await page
    .getByText("Исходный текст — для переноса материалов", { exact: true })
    .click();
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByRole("button", { name: /Строка 3:/ })).toBeVisible();
  expect(
    (await db.topic.findUniqueOrThrow({ where: { id: topic.id } })).version,
  ).toBe(0);
  expect(await db.gap.count({ where: { topicId: topic.id } })).toBe(0);
  await page
    .getByRole("textbox", { name: "Текст методички (Markdown)", exact: true })
    .fill(md());
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: topic.id } }))
          .contentMd,
    )
    .toBe(md());
  await page.reload();
  await page
    .getByText("Исходный текст — для переноса материалов", { exact: true })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Текст методички (Markdown)",
      exact: true,
    }),
  ).toHaveValue(md());
  await expect(
    page.getByRole("checkbox", { name: "Проверено экспертом", exact: true }),
  ).not.toBeChecked();
});

test("parallel editor changes produce a conflict without overwriting the local draft; preview is sanitized", async ({
  page,
  context,
}) => {
  const { topic } = await fixture(context.request);
  await page.goto(`/admin/topics/${topic.id}`);
  const second = await context.newPage();
  await second.goto(`/admin/topics/${topic.id}`);
  await second
    .getByRole("textbox", { name: "Название", exact: true })
    .fill("Сохранено другим редактором");
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: topic.id } })).title,
    )
    .toBe("Сохранено другим редактором");
  await page.bringToFront();
  const unsafe = `<script>window.__previewAttack=true</script>\n\n[x](javascript:alert%281%29)\n\n${md()}`;
  await page
    .getByRole("textbox", { name: "Текст методички", exact: true })
    .fill(unsafe);
  await expect(
    page.getByRole("alert").filter({ hasText: "другим редактором" }),
  ).toContainText("другим редактором");
  await expect(
    page.getByRole("textbox", {
      name: "Текст методички",
      exact: true,
    }),
  ).toHaveText(unsafe, { useInnerText: true });
  expect(
    (await db.topic.findUniqueOrThrow({ where: { id: topic.id } })).contentMd,
  ).toBe(md());
  const preview = page.getByRole("region", {
    name: "Предпросмотр",
    exact: true,
  });
  await expect(preview.locator("script")).toHaveCount(0);
  expect(
    await page.evaluate(() => Object.hasOwn(window, "__previewAttack")),
  ).toBe(false);
  await expect(preview.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Сохранить черновик", exact: true }),
  ).toBeDisabled();
  await second.close();
});

test("content APIs enforce role and Origin, validate references, and support safe CRUD", async ({
  context,
}) => {
  const { s, topic } = await fixture(context.request);
  await db.user.update({ where: { id: userId }, data: { role: "USER" } });
  for (const [path, method, body] of [
    ["subjects", "GET", undefined],
    ["preview", "POST", { contentMd: md() }],
    [`topics/${topic.id}`, "DELETE", { revision: topic.editRevision }],
  ] as const) {
    const response = await context.request.fetch(`/api/admin/content/${path}`, {
      method,
      data: body,
      headers: { Origin: origin },
    });
    expect(response.status()).toBe(403);
  }
  await db.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
  expect(
    (
      await context.request.post("/api/admin/content/preview", {
        data: { contentMd: md() },
        headers: { Origin: "https://attacker.example" },
      })
    ).status(),
  ).toBe(403);
  const section = await api<SectionDTO>(context.request, "sections", "POST", {
    subjectId: s.id,
    title: "Временный раздел",
    order: 0,
  });
  const changed = await api<SectionDTO>(
    context.request,
    `sections/${section.id}`,
    "PATCH",
    { title: "Изменённый раздел", order: 1, revision: section.editRevision },
  );
  expect(changed.editRevision).toBe(1);
  let row = await api<TopicDTO>(
    context.request,
    `topics/${topic.id}`,
    "PATCH",
    { ...fields(topic), sectionId: section.id, revision: topic.editRevision },
  );
  expect(
    (
      await context.request.delete(
        `/api/admin/content/sections/${section.id}`,
        {
          data: { revision: changed.editRevision },
          headers: { Origin: origin },
        },
      )
    ).status(),
  ).toBe(409);
  row = await api<TopicDTO>(context.request, `topics/${topic.id}`, "PATCH", {
    ...fields(row),
    sectionId: null,
    revision: row.editRevision,
  });
  await api(context.request, `sections/${section.id}`, "DELETE", {
    revision: changed.editRevision,
  });
  await api(context.request, `topics/${row.id}`, "DELETE", {
    revision: row.editRevision,
  });
  expect(await db.topic.findUnique({ where: { id: row.id } })).toBeNull();
  const draftSubject = await api<SubjectDTO>(
    context.request,
    `subjects/${s.id}`,
    "PATCH",
    {
      title: s.title,
      slug: s.slug,
      shortDescription: s.shortDescription,
      descriptionMd: s.descriptionMd,
      courses: s.courses,
      order: s.order,
      status: "DRAFT",
      seoTitle: null,
      seoDescription: null,
      revision: s.editRevision,
    },
  );
  await api(context.request, `subjects/${s.id}`, "DELETE", {
    revision: draftSubject.editRevision,
  });
  expect(await db.subject.findUnique({ where: { id: s.id } })).toBeNull();
});

test("subject search and pagination show the matching records", async ({
  page,
}) => {
  const records = Array.from({ length: 21 }, (_, i) => ({
    slug: `${prefix}-${i}`,
    title: `${prefix} · ${i}`,
    shortDescription: "Тест пагинации",
    courses: [1],
    order: i,
  }));
  await db.subject.createMany({ data: records });
  await page.goto(`/admin?q=${prefix}`);
  await expect(
    page
      .getByRole("navigation", {
        name: "Предметы, разделы и уроки",
        exact: true,
      })
      .getByRole("link", { name: new RegExp(prefix) }),
  ).toHaveCount(20);
  await page.getByRole("link", { name: "Далее", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(
    page
      .getByRole("navigation", {
        name: "Предметы, разделы и уроки",
        exact: true,
      })
      .getByRole("link", { name: new RegExp(prefix) }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Назад", exact: true }),
  ).toBeVisible();
});

test("editor configures multi and text questions, inserts a typed gap and publishes", async ({
  page,
}, testInfo) => {
  const f = await fixture(page.request);
  const topic = await fiveQuestions(page.request, f.topic);
  await page.goto(`/admin/topics/${topic.id}`);
  const edit = (name: string) =>
    page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .getByRole("button", { name: "Изменить", exact: true });
  const form = () =>
    page.locator("form").filter({
      has: page.getByRole("heading", {
        name: "Редактировать вопрос",
        exact: true,
      }),
    });
  await edit("Фикстура 1").click();
  await form()
    .getByRole("combobox", { name: "Тип задания", exact: true })
    .selectOption("MULTIPLE_CHOICE");
  await form().getByRole("checkbox", { name: "1", exact: true }).check();
  await form()
    .getByRole("button", { name: "Сохранить вопрос", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await db.question.findUniqueOrThrow({
            where: { id: topic.questions[1].id },
          })
        ).correctOptionIds,
    )
    .toEqual(["b", "a"]);
  await edit("Фикстура 2").click();
  await form()
    .getByRole("combobox", { name: "Тип задания", exact: true })
    .selectOption("SHORT_TEXT");
  await form()
    .getByRole("textbox", { name: "Эталон ответа", exact: true })
    .fill("зелёная ёлка");
  await form()
    .getByRole("textbox", {
      name: "Допустимые формулировки — по одной на строке",
      exact: true,
    })
    .fill("ель");
  await form()
    .getByRole("button", { name: "Сохранить вопрос", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await db.question.findUniqueOrThrow({
            where: { id: topic.questions[2].id },
          })
        ).acceptedAnswers,
    )
    .toEqual(["зелёная ёлка", "ель"]);
  const editor = page.getByRole("textbox", {
    name: "Текст методички",
    exact: true,
  });
  await editor
    .getByRole("button", { name: "Изменить пропуск «ответ-0»", exact: true })
    .click();
  const detail = page.getByRole("dialog", {
    name: "Настройка пропуска",
    exact: true,
  });
  await detail
    .getByRole("combobox", { name: "Тип задания", exact: true })
    .selectOption("MULTIPLE_CHOICE");
  await detail.getByRole("checkbox", { name: "2", exact: true }).check();
  await detail
    .getByRole("textbox", { name: "Объяснение после проверки", exact: true })
    .fill("Оба варианта верны в этом синтетическом примере.");
  await detail
    .getByRole("button", { name: "Сохранить пропуск", exact: true })
    .click();
  await expect(detail).not.toBeVisible();
  await editor.focus();
  await editor.press("Control+End");
  await editor.press("Enter");
  await page.keyboard.type("Дерево: ёлка");
  for (let i = 0; i < 4; i++) await editor.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Пропуск", exact: true }).click();
  const insert = detail;
  await insert
    .getByRole("combobox", { name: "Тип задания", exact: true })
    .selectOption("SHORT_TEXT");
  await insert
    .getByRole("textbox", { name: "Эталон ответа", exact: true })
    .fill("ёлка");
  await insert
    .getByRole("textbox", {
      name: "Допустимые формулировки — по одной на строке",
      exact: true,
    })
    .fill("ель");
  await insert
    .getByRole("button", { name: "Сохранить пропуск", exact: true })
    .click();
  await expect(insert).not.toBeVisible();
  await page
    .getByRole("button", {
      name: "Исходный текст — для переноса материалов",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Текст методички (Markdown)",
      exact: true,
    }),
  ).toHaveValue(/\[\[=ёлка\]\]/);
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: topic.id } }))
          .contentMd,
    )
    .toContain("[[=ёлка]]");
  await page.reload();
  await page
    .getByText("Исходный текст — для переноса материалов", { exact: true })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Текст методички (Markdown)",
      exact: true,
    }),
  ).toHaveValue(/\[\[=ёлка\]\]/);
  await page
    .getByRole("checkbox", { name: "Проверено экспертом", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Отправить на проверку", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: topic.id } })).status,
    )
    .toBe("REVIEW");
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(
    page.getByText("Материал опубликован", { exact: true }),
  ).toBeVisible();
  const gaps = await db.gap.findMany({
    where: { topicId: topic.id, archivedAt: null },
    orderBy: { order: "asc" },
  });
  expect(gaps).toHaveLength(11);
  expect(gaps[0].answerType).toBe("MULTIPLE_CHOICE");
  expect(gaps[0].correctAnswers).toHaveLength(2);
  expect(gaps[10]).toMatchObject({
    answerType: "SHORT_TEXT",
    acceptedAnswers: ["ёлка", "ель"],
  });
  await edit("Фикстура 2").click();
  await form()
    .getByRole("combobox", { name: "Тип задания", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `tmp/screenshots/exercise-editor-${testInfo.project.name}.png`,
  });
});
