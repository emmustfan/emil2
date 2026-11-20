import {
  expect as playwrightExpect,
  test,
  type BrowserContext,
} from "@playwright/test";
import { getDb } from "../../lib/db";
import { hashToken, newToken } from "../../lib/auth/crypto";
import { createOrgFixture } from "../helpers/org-fixture";
import { makeVideo } from "../helpers/video-fixture";
import { mockRutubePlayer } from "../helpers/rutube-player-fixture";

const db = getDb();
const expect = playwrightExpect.configure({ timeout: 20000 });
async function signIn(context: BrowserContext, userId: string) {
  const sid = newToken();
  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(sid),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  await context.addCookies([
    {
      name: "sid",
      value: sid,
      url: "http://localhost:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test("pauses the test iframe on a checkpoint, saves the answer, resumes and counts viewing", async ({
  page,
  context,
}) => {
  test.setTimeout(100000);
  const org = await createOrgFixture();
  try {
    const learner = await org.user("VideoStudent");
    const { topic, video, question } = await makeVideo(org.own, "free", 10);
    await signIn(context, learner.id);
    await mockRutubePlayer(page);
    await page.goto(`/learn/${org.own.subject.slug}/${topic.slug}`);
    const player = page.frameLocator('iframe[title="Проверочная видеолекция"]');
    await player.getByRole("button", { name: "Запустить фикстуру" }).click();
    await expect(
      page.getByRole("group", { name: "Вопрос в видео" }),
    ).toBeVisible();
    await expect(player.getByRole("status")).toHaveText("paused");
    await expect(page.getByText(question.explanation)).toHaveCount(0);
    await page.getByRole("radio", { name: "Неверный вариант видео" }).check();
    await page
      .getByRole("group", { name: "Вопрос в видео" })
      .getByRole("button", { name: "Проверить", exact: true })
      .click();
    await expect(
      page.getByText(question.explanation, { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Продолжить", exact: true }).click();
    await expect(player.getByRole("status")).toHaveText("stopped");
    await expect(
      page.getByText("Видеолекция просмотрена.", { exact: true }),
    ).toBeVisible();
    const progress = await db.videoProgress.findUniqueOrThrow({
      where: { userId_videoId: { userId: learner.id, videoId: video.id } },
    });
    expect(progress.watchedSec).toBeGreaterThanOrEqual(9);
    expect(progress.selfReported).toBe(false);
    expect(
      await db.questionAttempt.count({
        where: {
          questionId: question.id,
          testRun: { mode: "VIDEO", userId: learner.id },
        },
      }),
    ).toBe(1);
  } finally {
    await org.cleanup();
  }
});

test("offers self-report and a manual checkpoint when the test iframe sends no events", async ({
  page,
  context,
}) => {
  test.setTimeout(100000);
  const org = await createOrgFixture();
  try {
    const learner = await org.user("QuietVideoStudent");
    const { topic, video } = await makeVideo(org.own, "free");
    await signIn(context, learner.id);
    await mockRutubePlayer(page, true);
    await page.goto(`/learn/${org.own.subject.slug}/${topic.slug}`);
    await expect(
      page
        .frameLocator('iframe[title="Проверочная видеолекция"]')
        .getByRole("button", { name: "Запустить фикстуру" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Открыть вопрос", exact: true })
      .click();
    await expect(
      page.getByText("Что показано в проверочном фрагменте?"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Я посмотрел лекцию", exact: true })
      .click();
    await expect(
      page.getByText("Просмотр отмечен студентом.", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await db.videoProgress.findUniqueOrThrow({
          where: { userId_videoId: { userId: learner.id, videoId: video.id } },
        })
      ).selfReported,
    ).toBe(true);
  } finally {
    await org.cleanup();
  }
});

test.afterAll(async () => {
  await db.$disconnect();
});
