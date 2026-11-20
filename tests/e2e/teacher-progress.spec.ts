import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getDb } from "../../lib/db";
import {
  createTeacherProgressFixture,
  teacherProgressSession,
} from "../helpers/teacher-progress-fixture";

test("teacher filters the group journal, opens the student's answers and downloads the filtered CSV", async ({
  page,
  context,
}, info) => {
  test.setTimeout(90000);
  const f = await createTeacherProgressFixture();
  try {
    const sid = await teacherProgressSession(f.teacher.id);
    await context.addCookies([
      {
        name: "sid",
        value: sid,
        domain: "localhost",
        path: "/",
        httpOnly: true,
      },
    ]);
    await page.goto("/teacher/groups");
    await expect(page.getByText("Студентов 1 · заявок 1")).toBeVisible();
    await page
      .getByRole("link", { name: "Журнал · Предмет X для журнала" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Журнал группы Группа журнала 1" }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "Только отстающие" }).check();
    await page.getByRole("button", { name: "Показать", exact: true }).click();
    await expect(page).toHaveURL(/lagging=1/);
    const row = page.getByRole("row").filter({ hasText: "Иванов Студент" });
    await expect(row).toContainText("Отстающий");
    await expect(row).toContainText("По плееру");
    await expect(
      page.getByRole("link", { name: "Петров Студент" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `tmp/screenshots/group-journal-${info.project.name}.png`,
      fullPage: true,
    });
    const downloaded = page.waitForEvent("download", { timeout: 15000 });
    await page.getByRole("button", { name: "Скачать CSV" }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe("progress.csv");
    const csv = await readFile((await download.path())!);
    expect(Array.from(csv.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.toString()).toContain("Иванов Студент");
    expect(csv.toString()).not.toContain("Петров Студент");
    await row.getByRole("link", { name: "Иванов Студент" }).click();
    await expect(
      page.getByRole("heading", { name: "Иванов Студент" }),
    ).toBeVisible();
    await expect(page.getByText("Номер зачётки: ЗК-016")).toBeVisible();
    const firstGap = page
      .locator("summary")
      .filter({ hasText: /^Пропуск 1:/ })
      .first();
    await firstGap.click();
    await expect(
      page.getByText("Первый ответ: неверный-один · Неверно"),
    ).toBeVisible();
    await expect(
      page.getByText("Правильный ответ: верный-один", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Все попытки (2)")).toBeVisible();
    await page
      .getByText("Проверочная видеолекция · По плееру · Просмотрено 20%")
      .click();
    await expect(
      page.getByText("Ответ студента: Неверный вариант видео"),
    ).toBeVisible();
    await expect(
      page.getByText("Правильный ответ: Верный вариант видео"),
    ).toBeVisible();
    await expect
      .poll(() =>
        getDb().studentDataAccess.count({
          where: { ...f.ax, viewerId: f.teacher.id, studentId: f.student.id },
        }),
      )
      .toBe(2);
  } finally {
    await f.cleanup();
    await getDb().$disconnect();
  }
});
