import {
  expect as playwrightExpect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { getDb } from "../../lib/db";
import { hashToken, newToken } from "../../lib/auth/crypto";
import { createOrgFixture } from "../helpers/org-fixture";
import { lessonGap } from "../helpers/inline-gap";

const expect = playwrightExpect.configure({ timeout: 15000 });
const db = getDb();
const origin = "http://localhost:3100";

async function signIn(context: BrowserContext, userId: string) {
  const token = newToken();
  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  await context.addCookies([
    { name: "sid", value: token, url: origin, httpOnly: true, sameSite: "Lax" },
  ]);
}

async function enterFromInvitation(page: Page, email: string) {
  await expect(page).toHaveURL(/\/login\?next=%2Fjoin%2F[A-Z\d]{8}$/);
  await page.getByRole("textbox", { name: "Электронная почта" }).fill(email);
  await page.getByRole("button", { name: "Получить ссылку" }).click();
  await expect(page.getByRole("status")).toContainText("Проверьте почту");
  for (const name of await readdir("tmp/mails")) {
    const mail = JSON.parse(await readFile(`tmp/mails/${name}`, "utf8"));
    if (mail.to === email) {
      await page.goto(mail.text.match(/http[^\s]+/)[0]);
      await page.getByRole("button", { name: "Подтвердить вход" }).click();
      return;
    }
  }
  throw new Error("Не найдено письмо входа для студента");
}

test("faculty creates a group, head opens a subject, teacher approves and student completes a paid lesson", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120000);
  const f = await createOrgFixture();
  const facultyPage = await browser.newContext({ baseURL: origin });
  const headContext = await browser.newContext({ baseURL: origin });
  const teacherContext = await browser.newContext({ baseURL: origin });
  const ip = "10." + Array.from(randomBytes(3)).join(".");
  const learner = await f.user("GroupLearner");
  try {
    const manager = await f.user("FacultyManager", "EDITOR");
    await db.roleAssignment.createMany({
      data: [
        {
          userId: manager.id,
          role: "FACULTY_ADMIN",
          facultyId: f.faculty.id,
          scopeKey: "faculty:" + f.faculty.id,
        },
        {
          userId: f.author.id,
          role: "AUTHOR",
          departmentId: f.a.id,
          scopeKey: "department:" + f.a.id,
        },
      ],
    });
    await db.user.update({
      where: { id: learner.id },
      data: { consentPdAt: null },
    });
    await context.setExtraHTTPHeaders({ "X-Real-IP": ip });
    await page.route("https://telegram.org/**", (route) => route.abort());
    await page.route("https://oauth.telegram.org/**", (route) => route.abort());
    await Promise.all([
      signIn(facultyPage, manager.id),
      signIn(headContext, f.head.id),
      signIn(teacherContext, f.author.id),
    ]);

    const label = "Учебная группа 101";
    const faculty = await facultyPage.newPage();
    await faculty.goto("/teacher/groups");
    await faculty.getByRole("textbox", { name: "Название группы" }).fill(label);
    await faculty
      .getByRole("button", { name: "Создать группу", exact: true })
      .click();
    await expect(faculty).toHaveURL(/\/teacher\/groups\/[^/]+$/);
    await expect(
      faculty.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
    await faculty
      .getByRole("button", { name: "Создать код", exact: true })
      .click();
    await expect(
      faculty.getByRole("img", { name: "QR-код приглашения в группу" }),
    ).toBeVisible();
    const invite = (await faculty
      .getByRole("link", { name: /\/join\/[A-Z\d]{8}$/ })
      .getAttribute("href"))!;
    const detail = new URL(faculty.url()).pathname;

    const head = await headContext.newPage();
    await head.goto("/teacher/groups");
    await head.getByRole("link", { name: label, exact: true }).click();
    const subject = head.getByRole("combobox", {
      name: "Предмет",
      exact: true,
    });
    await expect(subject.getByRole("option")).toHaveText([
      "Предмет своей кафедры",
    ]);
    await head
      .getByRole("button", { name: "Открыть предмет", exact: true })
      .click();
    await head
      .getByRole("textbox", { name: "Имя, email или Telegram преподавателя" })
      .fill(f.author.email!);
    await head.getByRole("button", { name: "Найти преподавателя" }).click();
    await head
      .getByRole("combobox", { name: "Преподаватель", exact: true })
      .selectOption(f.author.id);
    await head
      .getByRole("button", { name: "Назначить преподавателя", exact: true })
      .click();
    await expect(
      head.getByRole("button", { name: "Снять назначение", exact: true }),
    ).toBeVisible();

    await page.goto(invite);
    await enterFromInvitation(page, learner.email!);
    await expect(page).toHaveURL(/\/onboarding$/);
    await page
      .getByRole("textbox", { name: "Имя", exact: true })
      .fill("Студент проверки");
    await page
      .getByRole("checkbox", {
        name: "Даю согласие на обработку персональных данных",
      })
      .check();
    await page.getByRole("button", { name: "Продолжить", exact: true }).click();
    await expect(page).toHaveURL(/\/cabinet\/groups\?code=[A-Z\d]{8}$/);
    await expect(page.getByLabel("Код группы")).toHaveValue(
      invite.split("/").at(-1)!,
    );
    await page.getByLabel("Фамилия", { exact: true }).fill("Учебный");
    await page.getByLabel("Имя", { exact: true }).fill("Студент");
    await expect(page.getByText(/НУЖНО СОГЛАСОВАНИЕ/)).toBeVisible();
    await page
      .getByRole("checkbox", { name: "Я прочитал(а) и принимаю уведомление" })
      .check();
    await page.getByRole("button", { name: "Вступить", exact: true }).click();
    await expect(
      page.getByText("Заявка на рассмотрении", { exact: true }),
    ).toBeVisible();

    const lesson = `/learn/${f.own.subject.slug}/paid`;
    await page.goto(lesson);
    await expect(
      page.getByText("ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ.", { exact: true }),
    ).toHaveCount(0);

    const teacher = await teacherContext.newPage();
    await teacher.goto("/teacher/groups");
    await teacher.getByRole("link", { name: label, exact: true }).click();
    await expect(teacher).toHaveURL(detail);
    await expect(
      teacher.getByText(learner.email!, { exact: true }),
    ).toBeVisible();
    await teacher
      .getByRole("button", { name: "Одобрить", exact: true })
      .click();
    await expect(teacher.getByText("Новых заявок нет.")).toBeVisible();

    await page.goto("/cabinet");
    await expect(
      page.getByText("Доступ по зачислению", { exact: true }),
    ).toBeVisible();
    await page.goto(lesson);
    await expect(
      page.getByText("ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ.", { exact: true }),
    ).toBeVisible();
    for (const [index, choice] of [
      [1, "верный-один"],
      [2, "верный-два"],
    ] as const) {
      const gap = lessonGap(page, index);
      await gap.getByRole("combobox").selectOption({ label: choice });
      await gap.getByRole("button", { name: "Проверить", exact: true }).click();
      await expect(gap.getByRole("status")).toContainText("Верно");
    }
    await page
      .getByRole("button", { name: "Начать тест", exact: true })
      .click();
    for (let i = 1; i <= 5; i++) {
      const form = page.locator("form").filter({
        has: page.getByRole("group", {
          name: `Вопрос ${i}: какой вариант выбрать?`,
        }),
      });
      await form.getByRole("radio", { name: "Вариант Б", exact: true }).check();
      await form
        .getByRole("button", { name: "Проверить", exact: true })
        .click();
      await expect(
        form.getByText(`ОБЪЯСНЕНИЕ_ПОСЛЕ_ОТВЕТА_${i}`, { exact: true }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("heading", { name: "Тема пройдена!" }),
    ).toBeVisible();
    expect(await db.subscription.count({ where: { userId: learner.id } })).toBe(
      0,
    );
    expect(await db.accessGrant.count({ where: { userId: learner.id } })).toBe(
      0,
    );
  } finally {
    await Promise.all([
      facultyPage.close(),
      headContext.close(),
      teacherContext.close(),
    ]);
    await db.loginToken.deleteMany({ where: { email: learner.email! } });
    await db.usageCounter.deleteMany({
      where: { feature: "group.join", actorKey: "ip:" + ip },
    });
    await db.authAttempt.deleteMany({ where: { key: "verify:" + ip } });
    await f.cleanup();
  }
});
test.afterAll(async () => {
  await db.$disconnect();
});
