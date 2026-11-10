import { expect, test, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
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
let f: LessonFixture,
  other: LessonFixture,
  admin: string,
  teacher: string,
  student: string,
  prefix: string;
const users: string[] = [],
  extra: BrowserContext[] = [];
test.setTimeout(90000);
async function makeUser(
  role: "USER" | "EDITOR" | "ADMIN",
  name: string,
  verified = true,
) {
  const legal = await currentLegal(),
    u = await db.user.create({
      data: {
        name,
        email: `${prefix}-${role}-${randomUUID()}@example.test`,
        emailVerifiedAt: verified ? new Date() : null,
        role,
        timezone: "Asia/Yekaterinburg",
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
test.beforeEach(async ({ context }) => {
  prefix = `roles-browser-${randomUUID()}`;
  f = await createLessonFixture("roles-browser-own");
  other = await createLessonFixture("roles-browser-other");
  await db.subject.update({
    where: { id: f.subject.id },
    data: { title: "Назначенный предмет" },
  });
  await db.subject.update({
    where: { id: other.subject.id },
    data: { title: "Чужой предмет учителя" },
  });
  admin = await makeUser("ADMIN", "Администратор проверки");
  teacher = await makeUser("USER", "Учитель проверки");
  student = await makeUser("USER", "Ученик проверки");
  await signIn(context, admin);
});
test.afterEach(async ({ context }) => {
  for (const c of [context, ...extra])
    for (const p of c.pages()) await p.close();
  for (const c of extra.splice(0)) await c.close();
  await cleanupLessonFixture(f);
  await cleanupLessonFixture(other, [], users.splice(0));
});
test.afterAll(async () => {
  await db.$disconnect();
});
test("sidebar navigation supports mobile keyboard dismissal, role switching and integration panels", async ({
  page,
}) => {
  await page.goto("/admin");
  const toggle = page.getByRole("button", {
    name: "Открыть меню",
    exact: true,
  });
  const mobile = await toggle.isVisible();
  if (mobile) {
    await expect(
      page.getByRole("link", { name: "Интеграции", exact: true }),
    ).not.toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("dialog", { name: "Меню кабинета" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
  }
  await page.getByRole("link", { name: "Интеграции", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/integrations$/);
  if (mobile) await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page
    .getByRole("navigation", { name: "Сервисы платформы" })
    .getByRole("link", { name: /ИИ-тьютор/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "ИИ: два вида модели", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Почта и повторный вход", exact: true }),
  ).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "ИИ: два вида модели", exact: true }),
  ).toBeVisible();
  if (mobile) await toggle.click();
  await page.getByRole("link", { name: "Моё обучение", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Моё обучение", exact: true }),
  ).toBeVisible();
  if (mobile) await toggle.click();
  await page.getByRole("link", { name: "Профиль", exact: true }).click();
  await expect(page).toHaveURL(/\/cabinet\/profile$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("administrator assigns a teacher, teacher edits only their subject, and revocation reaches an already open editor", async ({
  page,
  browser,
}, info) => {
  await page.goto(`/admin/users/${teacher}`);
  await page
    .getByRole("combobox", { name: "Роль", exact: true })
    .selectOption("EDITOR");
  await page
    .getByRole("checkbox", { name: "Назначенный предмет", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Сохранить доступ", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Доступ сохранён");
  await expect
    .poll(
      async () =>
        await db.teacherSubject.count({
          where: { teacherId: teacher, subjectId: f.subject.id },
        }),
    )
    .toBe(1);
  await mkdir("tmp/screenshots", { recursive: true });
  await page.screenshot({
    path: `tmp/screenshots/roles-admin-${info.project.name}.png`,
    fullPage: true,
  });
  const c = await browser.newContext({
    baseURL: origin,
    viewport: info.project.use.viewport,
  });
  extra.push(c);
  await signIn(c, teacher);
  const p = await c.newPage();
  await p.goto("/cabinet");
  await expect(p).toHaveURL(/\/teacher$/);
  await expect(
    p.getByRole("heading", { name: "Кабинет учителя", exact: true }),
  ).toBeVisible();
  await expect(
    p.getByRole("heading", { name: "Назначенный предмет", exact: true }),
  ).toBeVisible();
  await expect(
    p.getByText("Чужой предмет учителя", { exact: true }),
  ).toHaveCount(0);
  await p.screenshot({
    path: `tmp/screenshots/roles-teacher-${info.project.name}.png`,
    fullPage: true,
  });
  await p.getByRole("link", { name: "Открыть материалы", exact: true }).click();
  await expect(p.getByText("Настройки предмета", { exact: true })).toHaveCount(
    0,
  );
  await p.getByRole("link", { name: f.free.title, exact: true }).click();
  await expect(p).toHaveURL(new RegExp(`/admin/topics/${f.free.id}$`));
  await expect(
    p.getByRole("heading", { name: "Редактор темы", exact: true }),
  ).toBeVisible();
  const title = p.getByRole("textbox", { name: "Название", exact: true });
  await title.fill("Тема учителя после изменения");
  await expect
    .poll(
      async () =>
        (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } })).title,
    )
    .toBe("Тема учителя после изменения");
  expect(
    (
      await c.request.get(`/api/admin/content/topics/${other.free.id}`)
    ).status(),
  ).toBe(404);
  expect((await c.request.get("/api/admin/users")).status()).toBe(403);
  expect((await c.request.get("/admin/users")).status()).toBe(403);
  expect((await c.request.get("/admin/subjects/new")).status()).toBe(403);
  const hidden = await c.request.get(`/admin/topics/${other.free.id}`);
  expect(hidden.status()).toBe(404);
  expect(await hidden.text()).not.toContain(other.free.contentMd);
  await page
    .getByRole("checkbox", { name: "Назначенный предмет", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Сохранить доступ", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.user.findUniqueOrThrow({ where: { id: teacher } }))
          .roleRevision,
    )
    .toBe(2);
  await p.goto("/teacher");
  await expect(p.getByText(/Вам пока не назначены предметы/)).toBeVisible();
  expect(
    (await c.request.get(`/api/admin/content/topics/${f.free.id}`)).status(),
  ).toBe(404);
  const current = await db.topic.findUniqueOrThrow({
    where: { id: f.free.id },
  });
  const blocked = await c.request.post(
    `/api/admin/content/topics/${f.free.id}/status`,
    {
      headers: { Origin: origin },
      data: { revision: current.editRevision, status: "REVIEW" },
    },
  );
  expect(blocked.status()).toBe(404);
  expect(
    (await db.topic.findUniqueOrThrow({ where: { id: f.free.id } })).status,
  ).toBe("DRAFT");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("student has a personal workspace; blocking removes sessions and preserves learning after a new login", async ({
  page,
  browser,
}, info) => {
  const c = await browser.newContext({
    baseURL: origin,
    viewport: info.project.use.viewport,
  });
  extra.push(c);
  await signIn(c, student);
  const p = await c.newPage();
  await p.goto("/cabinet");
  await expect(
    p.getByRole("heading", { name: "Кабинет ученика", exact: true }),
  ).toBeVisible();
  expect((await c.request.get("/teacher")).status()).toBe(403);
  expect((await c.request.get("/admin")).status()).toBe(403);
  expect((await c.request.get("/api/admin/users")).status()).toBe(403);
  await p.goto(`/learn/${f.subject.slug}/free`);
  const form = p
    .locator("form")
    .filter({ has: p.getByRole("group", { name: "Пропуск 1", exact: true }) });
  await form.getByRole("radio", { name: "верный-один", exact: true }).check();
  await form.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Верно");
  await p.goto("/cabinet");
  await expect(
    p.getByRole("link", { name: f.free.title, exact: true }),
  ).toBeVisible();
  await p.screenshot({
    path: `tmp/screenshots/roles-student-${info.project.name}.png`,
    fullPage: true,
  });
  await page.goto(`/admin/users/${student}`);
  await page
    .getByRole("checkbox", { name: "Заблокировать вход", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Сохранить доступ", exact: true })
    .click();
  await expect
    .poll(async () => await db.session.count({ where: { userId: student } }))
    .toBe(0);
  await p.goto("/cabinet");
  await expect(p).toHaveURL(/\/login$/);
  expect(await db.gapAnswer.count({ where: { userId: student } })).toBe(1);
  await page
    .getByRole("checkbox", { name: "Заблокировать вход", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Сохранить доступ", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db.user.findUniqueOrThrow({ where: { id: student } })).blockedAt,
    )
    .toBeNull();
  await p.goto("/cabinet");
  await expect(p).toHaveURL(/\/login$/);
  await signIn(c, student);
  await p.goto(`/learn/${f.subject.slug}/free`);
  await expect(form.getByRole("status")).toContainText("Верно");
  await page.goto("/cabinet");
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/users/${admin}`);
  await expect(
    page.getByRole("combobox", { name: "Роль", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "Заблокировать вход", exact: true }),
  ).toBeDisabled();
});
test("management API rejects foreign origins, forged fields, unverified elevation and stale revisions", async ({
  page,
  browser,
}) => {
  const input = {
      revision: 0,
      role: "EDITOR",
      blocked: false,
      subjectIds: [f.subject.id],
    },
    url = `/api/admin/users/${teacher}`;
  expect(
    (
      await page.request.patch(url, {
        headers: { Origin: "https://foreign.example" },
        data: input,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.patch(url, {
        headers: { Origin: origin },
        data: { ...input, actorId: admin },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await page.request.patch(url, {
        headers: { Origin: origin },
        data: { ...input, subjectIds: [f.subject.id, f.subject.id] },
      })
    ).status(),
  ).toBe(422);
  const unverified = await makeUser(
    "USER",
    "Неподтверждённый пользователь",
    false,
  );
  expect(
    (
      await page.request.patch(`/api/admin/users/${unverified}`, {
        headers: { Origin: origin },
        data: input,
      })
    ).status(),
  ).toBe(409);
  const updated = await page.request.patch(url, {
    headers: { Origin: origin },
    data: input,
  });
  expect(updated.status()).toBe(200);
  expect(updated.headers()["cache-control"]).toContain("no-store");
  expect(
    (
      await page.request.patch(url, {
        headers: { Origin: origin },
        data: input,
      })
    ).status(),
  ).toBe(409);
  const wire = await updated.text();
  for (const secret of [
    "tokenHash",
    "consentPdVersion",
    "offerVersion",
    "loginToken",
  ])
    expect(wire).not.toContain(secret);
  const c = await browser.newContext({ baseURL: origin });
  extra.push(c);
  await signIn(c, teacher);
  expect(
    (
      await c.request.patch(url, {
        headers: { Origin: origin },
        data: { revision: 1, role: "ADMIN", blocked: false, subjectIds: [] },
      })
    ).status(),
  ).toBe(403);
  const guest = await browser.newContext({ baseURL: origin });
  extra.push(guest);
  expect((await guest.request.get("/api/admin/users")).status()).toBe(401);
  const list = await page.request.get(
    `/api/admin/users?q=${encodeURIComponent(prefix)}&role=EDITOR&state=ACTIVE`,
  );
  expect(list.status()).toBe(200);
  expect((await list.json()).items.map((u: { id: string }) => u.id)).toEqual([
    teacher,
  ]);
});
test("role changes apply to an existing session and a demoted teacher loses editor APIs", async ({
  page,
  browser,
}) => {
  const c = await browser.newContext({ baseURL: origin });
  extra.push(c);
  await signIn(c, teacher);
  const p = await c.newPage();
  await p.goto("/cabinet");
  await expect(
    p.getByRole("heading", { name: "Кабинет ученика", exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.patch(`/api/admin/users/${teacher}`, {
        headers: { Origin: origin },
        data: {
          revision: 0,
          role: "EDITOR",
          blocked: false,
          subjectIds: [f.subject.id],
        },
      })
    ).status(),
  ).toBe(200);
  await p.reload();
  await expect(p).toHaveURL(/\/teacher$/);
  expect(
    (await c.request.get(`/api/admin/content/topics/${f.free.id}`)).status(),
  ).toBe(200);
  expect(
    (
      await page.request.patch(`/api/admin/users/${teacher}`, {
        headers: { Origin: origin },
        data: { revision: 1, role: "USER", blocked: false, subjectIds: [] },
      })
    ).status(),
  ).toBe(200);
  expect(
    (await c.request.get(`/api/admin/content/topics/${f.free.id}`)).status(),
  ).toBe(403);
  await p.goto("/cabinet");
  await expect(
    p.getByRole("heading", { name: "Кабинет ученика", exact: true }),
  ).toBeVisible();
  expect(await db.teacherSubject.count({ where: { teacherId: teacher } })).toBe(
    0,
  );
  expect(await db.topic.count({ where: { subjectId: f.subject.id } })).toBe(2);
});
