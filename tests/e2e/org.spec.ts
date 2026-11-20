import { expect, test, type BrowserContext } from "@playwright/test";
import { getDb } from "../../lib/db";
import { hashToken, newToken } from "../../lib/auth/crypto";
import {
  createOrgFixture,
  readyTopic,
  readyQuestion,
} from "../helpers/org-fixture";
import type { TopicDTO } from "../../lib/content/types";

const db = getDb(),
  origin = "http://localhost:3100";
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

test("department head appoints an author, who creates and publishes a lesson within the department", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await createOrgFixture(),
    authorContext = await browser.newContext({ baseURL: origin });
  try {
    await signIn(context, f.head.id);
    await signIn(authorContext, f.author.id);
    await page.goto("/teacher");
    await page
      .getByRole("link", { name: "Сотрудники кафедры", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: f.a.title, exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Имя или email", { exact: true })
      .fill(f.author.email!);
    await page.getByRole("button", { name: "Найти", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Роль", exact: true })
      .selectOption("AUTHOR");
    await page.getByRole("button", { name: "Назначить", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Снять назначение", exact: true }),
    ).toBeVisible();

    const author = await authorContext.newPage();
    await author.goto("/teacher");
    await expect(
      author.getByRole("heading", {
        name: "Предмет своей кафедры",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      author.getByText("Предмет чужой кафедры", { exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await authorContext.request.get(
          "/api/admin/content/topics/" + f.other.free.id,
        )
      ).status(),
    ).toBe(404);
    const write = async (path: string, body: unknown, method = "POST") => {
      const response = await authorContext.request.fetch(
        "/api/admin/content/" + path,
        { method, headers: { Origin: origin }, data: body },
      );
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()) as TopicDTO;
    };
    let topic = await write("topics", readyTopic(f.own.subject.id));
    for (let i = 1; i <= 5; i++) {
      topic = await write(`topics/${topic.id}/questions`, {
        ...readyQuestion(i),
        topicRevision: topic.editRevision,
      });
    }
    const { subjectId, ...fields } = readyTopic(f.own.subject.id);
    expect(subjectId).toBe(topic.subjectId);
    topic = await write(
      `topics/${topic.id}`,
      {
        ...fields,
        slug: topic.slug,
        contentMd: topic.contentMd,
        revision: topic.editRevision,
      },
      "PATCH",
    );
    topic = await write(`topics/${topic.id}/status`, {
      revision: topic.editRevision,
      status: "REVIEW",
    });
    const published = await write(`topics/${topic.id}/publish`, {
      revision: topic.editRevision,
    });
    expect(published.status).toBe("PUBLISHED");
    await author.goto(`/learn/${f.own.subject.slug}/${published.slug}`);
    await expect(
      author.getByRole("heading", { name: published.title, exact: true }),
    ).toBeVisible();
    const revoked = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/org/assignments/remove") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Снять назначение", exact: true })
      .click();
    expect((await revoked).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Снять назначение", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await authorContext.request.get("/api/admin/content/topics/" + topic.id)
      ).status(),
    ).toBe(403);
  } finally {
    await authorContext.close();
    await f.cleanup();
  }
});
