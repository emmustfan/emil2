import { expect, test, type Page } from "@playwright/test";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { getDb } from "../../lib/db";
import { hashToken } from "../../lib/auth/crypto";
const db = getDb();
const origin = "http://localhost:3100";
const emails: string[] = [];
const telegramIds: bigint[] = [];
const hashes: string[] = [];
const legalIds: string[] = [];
const ips: string[] = [];
function address() {
  const email = `e2e-${randomUUID()}@example.test`;
  emails.push(email);
  return email;
}
async function mailToken(email: string) {
  const row = await db.loginToken.findFirstOrThrow({
    where: { email },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  for (const name of await readdir("tmp/mails")) {
    const mail = JSON.parse(await readFile(`tmp/mails/${name}`, "utf8"));
    if (mail.to !== email) continue;
    const token = new URL(mail.text.match(/http[^\s]+/)[0]).searchParams.get(
      "token",
    )!;
    if (hashToken(token) === row.tokenHash) return token;
  }
  throw new Error("No matching test email");
}
async function requestLink(page: Page, email: string) {
  await page.getByRole("textbox", { name: "Электронная почта" }).fill(email);
  await page.getByRole("button", { name: "Получить ссылку" }).click();
  await expect(page.getByRole("status")).toContainText("Проверьте почту");
  return mailToken(email);
}
async function finishOnboarding(page: Page) {
  await expect(page).toHaveURL(/\/onboarding$/);
  const checkbox = page.getByRole("checkbox", {
    name: "Даю согласие на обработку персональных данных",
  });
  await expect(checkbox).not.toBeChecked();
  await page
    .getByRole("textbox", { name: "Имя", exact: true })
    .fill("Студент Тест");
  await checkbox.check();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/(?:cabinet|admin)$/);
}
async function enter(page: Page, email = address()) {
  await page.goto("/login");
  const token = await requestLink(page, email);
  await page.goto(`/auth/verify?token=${token}`);
  await page.getByRole("button", { name: "Подтвердить вход" }).click();
  await finishOnboarding(page);
  return { token, email };
}
test.beforeEach(async ({ context, page }) => {
  const ip = `192.0.2.${20 + Math.floor(Math.random() * 200)}`;
  ips.push(ip);
  await context.setExtraHTTPHeaders({ "X-Real-IP": ip });
  // Tests are offline with respect to Telegram; only synthetic signed server payloads are used.
  await page.route("https://telegram.org/**", (route) => route.abort());
  await page.route("https://oauth.telegram.org/**", (route) => route.abort());
});
test.afterEach(async () => {
  if (legalIds.length)
    await db.legalDocument.deleteMany({
      where: { id: { in: legalIds.splice(0) } },
    });
  const users = await db.user.findMany({
    where: {
      OR: [{ email: { in: emails } }, { telegramId: { in: telegramIds } }],
    },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await db.session.deleteMany({ where: { userId: { in: ids } } });
  await db.loginToken.deleteMany({
    where: { OR: [{ email: { in: emails } }, { intentUserId: { in: ids } }] },
  });
  await db.telegramAuthUse.deleteMany({ where: { hash: { in: hashes } } });
  await db.authAttempt.deleteMany({
    where: {
      key: { in: ips.flatMap((ip) => [`telegram:${ip}`, `verify:${ip}`]) },
    },
  });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  emails.length = 0;
  telegramIds.length = 0;
  hashes.length = 0;
  ips.length = 0;
});
test.afterAll(async () => {
  await db.$disconnect();
});

test("email link, explicit consent, profile, role guard and logout", async ({
  page,
  context,
}) => {
  const email = address();
  await page.goto("/cabinet/profile");
  await expect(page).toHaveURL(/\/login$/);
  const token = await requestLink(page, email);
  await expect(
    page.getByRole("button", { name: /Повторная отправка/ }),
  ).toBeDisabled();
  await page.goto(`/auth/verify?token=${token}`);
  expect(
    (
      await db.loginToken.findUniqueOrThrow({
        where: { tokenHash: hashToken(token) },
      })
    ).usedAt,
  ).toBeNull();
  const outsider = await context
    .browser()!
    .newContext({ extraHTTPHeaders: { "X-Real-IP": ips[0] } });
  const wrong = await outsider.request.post(`${origin}/api/auth/verify`, {
    form: { token },
    headers: { Origin: origin },
  });
  expect(wrong.status()).toBe(400);
  await outsider.close();
  await page.getByRole("button", { name: "Подтвердить вход" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/cabinet/profile");
  await expect(page).toHaveURL(/\/onboarding$/);
  const skipped = await context.request.post("/api/onboarding", {
    form: {
      name: "Test",
      university: "",
      course: "",
      timezone: "UTC",
      consentVersion: "0.1",
      offerVersion: "0.1",
    },
    headers: { Origin: origin },
  });
  expect(skipped.status()).toBe(422);
  await finishOnboarding(page);
  const cookies = await context.cookies();
  const sid = cookies.find((c) => c.name === "sid")!;
  expect(sid.httpOnly).toBe(true);
  expect(sid.sameSite).toBe("Lax");
  expect(
    (await context.request.get("/admin", { maxRedirects: 0 })).status(),
  ).toBe(403);
  const replay = await context.request.post("/api/auth/verify", {
    form: { token },
    headers: { Origin: origin },
  });
  expect(replay.status()).toBe(400);
  await page.goto("/cabinet/profile");
  await page
    .getByRole("textbox", { name: "Имя", exact: true })
    .fill("Обновлённое имя");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Изменения сохранены");
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Имя", exact: true }),
  ).toHaveValue("Обновлённое имя");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await db.session.findUnique({ where: { tokenHash: hashToken(sid.value) } }),
  ).toBeNull();
});

test("rejects forged origin, unconfirmed email change and outdated consent", async ({
  page,
  context,
}) => {
  const rejected = address();
  const hostile = await context.request.post("/api/auth/email", {
    data: { email: rejected, intent: "login" },
    headers: { Origin: "https://attacker.example" },
  });
  expect(hostile.status()).toBe(403);
  expect(await db.loginToken.count({ where: { email: rejected } })).toBe(0);
  const { email } = await enter(page);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await page.goto("/cabinet/profile");
  const replacement = address();
  const token = await requestLink(page, replacement);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).email,
  ).toBe(email);
  await page.goto(`/auth/verify?token=${token}`);
  await page.getByRole("button", { name: "Подтвердить вход" }).click();
  await expect(page).toHaveURL(/\/cabinet$/);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).email,
  ).toBe(replacement);
  const doc = await db.legalDocument.create({
    data: {
      kind: "consent",
      version: `e2e-${randomUUID()}`,
      contentMd: "Тестовая версия для проверки повторного согласия",
      publishedAt: new Date(),
    },
  });
  legalIds.push(doc.id);
  await page.goto("/cabinet/profile");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  const forged = await context.request.post("/api/onboarding", {
    form: {
      name: "Student",
      university: "",
      course: "",
      timezone: "UTC",
      consent: "on",
      consentVersion: user.consentPdVersion!,
      offerVersion: user.offerVersion!,
    },
    headers: { Origin: origin },
  });
  expect(forged.status()).toBe(409);
  await finishOnboarding(page);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } }))
      .consentPdVersion,
  ).toBe(doc.version);
});

test("synthetic Telegram login and replay protection", async ({
  page,
  context,
}) => {
  const id = String(2000000000 + Math.floor(Math.random() * 100000000));
  telegramIds.push(BigInt(id));
  const data = {
    id,
    first_name: "Telegram студент",
    username: "fixture",
    auth_date: Math.floor(Date.now() / 1000),
  };
  const check = Object.entries(data)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const hash = createHmac(
    "sha256",
    createHash("sha256").update("123456:fixture-only-not-a-real-key").digest(),
  )
    .update(check)
    .digest("hex");
  hashes.push(hash);
  const response = await context.request.post("/api/auth/telegram", {
    data: { data: { ...data, hash }, intent: "login" },
    headers: { Origin: origin },
  });
  expect(response.status()).toBe(200);
  await page.goto("/cabinet");
  await finishOnboarding(page);
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  const replay = await context.request.post("/api/auth/telegram", {
    data: { data: { ...data, hash }, intent: "login" },
    headers: { Origin: origin },
  });
  expect(replay.status()).toBe(400);
  // Exercise the widget message bridge without contacting Telegram or using a real bot.
  const fresh = { ...data, auth_date: data.auth_date - 1 };
  const freshCheck = Object.entries(fresh)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const freshHash = createHmac(
    "sha256",
    createHash("sha256").update("123456:fixture-only-not-a-real-key").digest(),
  )
    .update(freshCheck)
    .digest("hex");
  hashes.push(freshHash);
  const message = {
    event: "auth_user",
    auth_data: { ...fresh, hash: freshHash },
  };
  await page.goto("/login");
  await page.evaluate(
    (data) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://oauth.telegram.org",
          source: window,
          data: JSON.stringify(data),
        }),
      ),
    message,
  );
  expect(
    (await context.cookies()).some((cookie) => cookie.name === "sid"),
  ).toBe(false);
  await page.route("https://oauth.telegram.org/embed/fixture_bot", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<script>parent.postMessage(${JSON.stringify(JSON.stringify(message))}, "${origin}")</script>`,
    }),
  );
  await page.getByLabel("Войти через Telegram").evaluate((element) => {
    const iframe = document.createElement("iframe");
    iframe.src = "https://oauth.telegram.org/embed/fixture_bot";
    element.appendChild(iframe);
  });
  await expect(page).toHaveURL(/\/cabinet$/);
});

test("admin list elevates an authenticated owner and staff use distinct workspaces", async ({
  page,
  context,
}, info) => {
  const email = `owner-${info.project.name}-${process.env.E2E_RUN_ID}@example.test`;
  emails.push(email);
  await enter(page, email);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Кабинет администратора" }),
  ).toBeVisible();
  await db.user.update({ where: { email }, data: { role: "EDITOR" } });
  const teacherRedirect = await context.request.get("/admin", {
    maxRedirects: 0,
  });
  expect(teacherRedirect.status()).toBe(307);
  expect(teacherRedirect.headers().location).toContain("/teacher");
  expect((await context.request.get("/teacher")).status()).toBe(200);
  await db.user.update({ where: { email }, data: { role: "USER" } });
  expect(
    (await context.request.get("/admin", { maxRedirects: 0 })).status(),
  ).toBe(403);
});
