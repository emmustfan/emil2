import { expect, test } from "@playwright/test";
test("landing, examples, metadata and mobile navigation", async ({
  page,
  isMobile,
}) => {
  await page.goto("/?utm_source=browser-test");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Разобраться. Проверить себя. Запомнить.",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  if (isMobile) await page.getByText("☰ Меню", { exact: true }).click();
  await page
    .getByRole("link", { name: "Как это работает", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/#approach$/);
  await expect(
    page.getByRole("heading", { name: "Возвращайтесь к карточкам" }),
  ).toBeVisible();
  const example = page.locator("#exercise-example-first");
  await example.getByRole("radio", { name: "тест", exact: true }).check();
  await example.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(example.getByRole("status")).toContainText("Верно");
  await page.getByRole("button", { name: "Показать ответ карточки" }).click();
  await page.getByRole("button", { name: "Норм", exact: true }).click();
  await expect(
    page.getByText("Так назначается следующий повтор.", { exact: false }),
  ).toBeVisible();
  expect(
    await page.locator('meta[property="og:title"]').getAttribute("content"),
  ).toContain("Разобраться");
  const structured = await page
    .locator('script[type="application/ld+json"]')
    .textContent();
  expect(structured).toContain("Organization");
  expect(structured).toContain("FAQPage");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
