import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { getDb } from "../../lib/db";
import { getEnv, parseEnv } from "../../lib/env";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import { requestEmail, verifyEmail } from "../../lib/auth/email";
import { createSession, findSession } from "../../lib/auth/session";
import { hashToken, newToken } from "../../lib/auth/crypto";
import { loginTelegram } from "../../lib/auth/telegram-login";
import { consumeAuthAttempt } from "../../lib/auth/rate";
import { createMailTransport } from "../../lib/mail";
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    DEFAULT_SETTINGS[key],
}));
const db = getDb();
const prefix = `integration-${randomUUID()}`;
const emails: string[] = [];
const ids: string[] = [];
const hashes: string[] = [];
const rateKey = `${prefix}:rate`;
const bot = "123456:fixture-only-not-a-real-key";
const telegramId = String(1000000000 + Math.floor(Math.random() * 1000000000));
function email() {
  const address = `${prefix}-${emails.length}@example.test`;
  emails.push(address);
  return address;
}
async function tokenFor(address: string) {
  const latest = await db.loginToken.findFirstOrThrow({
    where: { email: address },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  for (const name of await readdir("tmp/mails")) {
    const mail = JSON.parse(await readFile(`tmp/mails/${name}`, "utf8"));
    if (mail.to !== address) continue;
    const token = new URL(mail.text.match(/http[^\s]+/)[0]).searchParams.get(
      "token",
    )!;
    if (hashToken(token) === latest.tokenHash) return token;
  }
  throw new Error("Fixture mail not found");
}

async function issue(
  address = email(),
  flow = newToken(),
  intent: string | null = null,
  ip = `${prefix}:${address}`,
) {
  await requestEmail(address, ip, flow, intent);
  return { address, flow, token: await tokenFor(address) };
}
async function login() {
  const auth = await issue();
  const result = await verifyEmail(auth.token, auth.flow, null);
  ids.push(result.user.id);
  return { auth, ...result };
}
function signed(id = telegramId, seconds = Math.floor(Date.now() / 1000)) {
  const data = {
    id,
    first_name: "Тест",
    username: "fixture",
    auth_date: seconds,
  };
  const str = Object.entries(data)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  return {
    ...data,
    hash: createHmac("sha256", createHash("sha256").update(bot).digest())
      .update(str)
      .digest("hex"),
  };
}
beforeAll(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", bot);
  vi.stubEnv("TELEGRAM_BOT_USERNAME", "fixture_bot");
});
afterAll(async () => {
  const users = await db.user.findMany({
    where: {
      OR: [
        { id: { in: ids } },
        { email: { in: emails } },
        { telegramId: BigInt(telegramId) },
      ],
    },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  await db.loginToken.deleteMany({
    where: {
      OR: [{ email: { in: emails } }, { intentUserId: { in: userIds } }],
    },
  });
  await db.telegramAuthUse.deleteMany({ where: { hash: { in: hashes } } });
  await db.authAttempt.deleteMany({ where: { key: rateKey } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  vi.unstubAllEnvs();
  await db.$disconnect();
});
describe("authentication with real PostgreSQL", () => {
  it("claims one email token atomically under concurrent verification", async () => {
    const auth = await issue();
    const row = await db.loginToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(auth.token) },
    });
    expect(row.tokenHash).not.toBe(auth.token);
    expect(row.requestNonceHash).toBe(hashToken(auth.flow));
    const results = await Promise.allSettled([
      verifyEmail(auth.token, auth.flow, null),
      verifyEmail(auth.token, auth.flow, null),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const result = results.find((r) => r.status === "fulfilled")!;
    if (result.status === "fulfilled") {
      ids.push(result.value.user.id);
      expect(await findSession(result.value.token)).not.toBeNull();
    }
  });
  it("rejects expired links and links opened in a different browser without consuming them", async () => {
    const auth = await issue();
    await expect(
      verifyEmail(auth.token, newToken(), null),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(
      (
        await db.loginToken.findUniqueOrThrow({
          where: { tokenHash: hashToken(auth.token) },
        })
      ).usedAt,
    ).toBeNull();
    await db.loginToken.update({
      where: { tokenHash: hashToken(auth.token) },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await expect(
      verifyEmail(auth.token, auth.flow, null),
    ).rejects.toMatchObject({ code: "invalid" });
  });
  it("preserves existing users, promotes configured admins and denies blocked/deleted accounts", async () => {
    const admin = email();
    vi.stubEnv("ADMIN_EMAILS", admin.toUpperCase());
    const auth = await issue(admin);
    const result = await verifyEmail(auth.token, auth.flow, null);
    ids.push(result.user.id);
    expect(result.user.role).toBe("ADMIN");
    vi.stubEnv("ADMIN_EMAILS", "");
    for (const field of ["blockedAt", "deletedAt"] as const) {
      const a = await issue();
      const user = await db.user.create({
        data: { email: a.address, [field]: new Date() },
      });
      ids.push(user.id);
      await expect(verifyEmail(a.token, a.flow, null)).rejects.toMatchObject({
        code: "invalid",
      });
      expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    }
  });
  it("binds a confirmed email change to the initiating account and revokes older sessions", async () => {
    const user = await login();
    const replacement = await issue(email(), newToken(), user.user.id);
    await expect(
      verifyEmail(replacement.token, replacement.flow, null),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.user.id } })).email,
    ).toBe(user.auth.address);
    const changed = await verifyEmail(
      replacement.token,
      replacement.flow,
      user.user.id,
    );
    expect(changed.user.email).toBe(replacement.address);
    expect(await findSession(user.token)).toBeNull();
    expect((await findSession(changed.token))?.userId).toBe(user.user.id);
  });
  it("does not merge two accounts when linking an existing email", async () => {
    const a = await login(),
      b = await login();
    await db.loginToken.updateMany({
      where: { email: b.auth.address },
      data: { createdAt: new Date(Date.now() - 120000) },
    });
    const auth = await issue(b.auth.address, newToken(), a.user.id);
    await expect(
      verifyEmail(auth.token, auth.flow, a.user.id),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: a.user.id } })).email,
    ).toBe(a.auth.address);
  });
  it("limits sessions to five even with parallel sign-ins", async () => {
    const user = await login();
    const sessions = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.$transaction((tx) => createSession(tx, user.user.id, 30, 5)),
      ),
    );
    expect(await db.session.count({ where: { userId: user.user.id } })).toBe(5);
    expect(
      (await Promise.all(sessions.map((s) => findSession(s.token)))).filter(
        Boolean,
      ),
    ).toHaveLength(5);
  });
  it("expires and slides sessions without reviving revoked ones", async () => {
    const user = await login();
    await db.session.update({
      where: { tokenHash: hashToken(user.token) },
      data: { lastSeenAt: new Date(Date.now() - 2 * 86400000) },
    });
    const refreshed = await findSession(user.token, true);
    expect(refreshed?.renewed).toBe(true);
    expect((await findSession(user.token, true))?.renewed).toBe(false);
    await db.session.update({
      where: { tokenHash: hashToken(user.token) },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(await findSession(user.token, true)).toBeNull();
  });
  it("enforces email cooldown, rolling email/IP caps and Telegram attempt cap", async () => {
    const address = email();
    await issue(address);
    await expect(
      requestEmail(address, prefix, newToken(), null),
    ).rejects.toMatchObject({ code: "rate" });
    await db.loginToken.updateMany({
      where: { email: address },
      data: { createdAt: new Date(Date.now() - 120000) },
    });
    for (let i = 0; i < 2; i++)
      await db.loginToken.create({
        data: {
          email: address,
          tokenHash: hashToken(newToken()),
          requestNonceHash: hashToken(newToken()),
          expiresAt: new Date(Date.now() + 60000),
          createdAt: new Date(Date.now() - 120000),
        },
      });
    await expect(
      requestEmail(address, prefix, newToken(), null),
    ).rejects.toMatchObject({ code: "rate" });
    const ip = `${prefix}:ip`;
    for (let i = 0; i < 10; i++)
      await db.loginToken.create({
        data: {
          email: email(),
          ip,
          tokenHash: hashToken(newToken()),
          requestNonceHash: hashToken(newToken()),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
    await expect(
      requestEmail(email(), ip, newToken(), null),
    ).rejects.toMatchObject({ code: "rate" });
    await Promise.all(
      Array.from({ length: 10 }, () => consumeAuthAttempt(rateKey)),
    );
    await expect(consumeAuthAttempt(rateKey)).rejects.toMatchObject({
      code: "rate",
    });
  });
  it("authenticates Telegram, rejects replay and keeps email and Telegram accounts separate", async () => {
    const data = signed();
    hashes.push(data.hash);
    const user = await loginTelegram(data, null);
    ids.push(user.user.id);
    expect(user.user.telegramId).toBe(BigInt(telegramId));
    await expect(loginTelegram(data, null)).rejects.toMatchObject({
      code: "invalid",
    });
    const other = await login();
    const again = signed(telegramId, Math.floor(Date.now() / 1000) - 1);
    hashes.push(again.hash);
    await expect(loginTelegram(again, other.user.id)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: other.user.id } }))
        .telegramId,
    ).toBeNull();
  });
  it("delivers mail through the real SMTP adapter to local Mailpit", async () => {
    const subject = `SMTP ${prefix}`;
    const env = parseEnv({
      ...getEnv(),
      NODE_ENV: "test",
      TRUST_PROXY: "false",
      MAIL_TRANSPORT: "smtp",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: 1025,
    });
    await createMailTransport(env).send({
      to: email(),
      subject,
      text: "Synthetic SMTP authentication test.",
    });
    const data = await (
      await fetch("http://127.0.0.1:8025/api/v1/messages")
    ).json();
    expect(
      data.messages.some((m: { Subject: string }) => m.Subject === subject),
    ).toBe(true);
  });
});
