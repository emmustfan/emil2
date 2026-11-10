import type { Page } from "@playwright/test";
// Both inline gaps and multi-answer cards retain their existing exercise IDs.
export function lessonGap(page: Page, number: number) {
  return page
    .getByRole("group", { name: `Пропуск ${number}`, exact: true })
    .locator('xpath=ancestor-or-self::*[starts-with(@id,"exercise-")][1]');
}
