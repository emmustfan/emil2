import { expect, test } from "@playwright/test";
test("foundation page and anchor navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Знания, на которые можно опереться.",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page.getByRole("link", { name: "Что готовим" }).click();
  await expect(page).toHaveURL(/#approach$/);
  await expect(page.getByRole("heading", { name: "Закрепить" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
