import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  newToken,
  hashToken,
  isToken,
  matchesToken,
} from "../../lib/auth/crypto";
import { verifyTelegram } from "../../lib/auth/telegram";
import { adminRole, profileSchema } from "../../lib/auth/validation";
import { decodeSetting } from "../../lib/settings/defaults";
const bot = "123456:fixture-only-not-a-real-key";
const now = new Date("2026-11-06T10:00:00Z");
function signed(extra: Record<string, string | number> = {}) {
  const data = {
    id: 123456789,
    first_name: "Студент",
    username: "fixture",
    auth_date: Math.floor(now.getTime() / 1000),
    ...extra,
  };
  const check = Object.entries(data)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  return {
    ...data,
    hash: createHmac("sha256", createHash("sha256").update(bot).digest())
      .update(check)
      .digest("hex"),
  };
}
describe("authentication primitives", () => {
  it("creates independent 256-bit tokens and verifies only their hashes", () => {
    const token = newToken();
    expect(isToken(token)).toBe(true);
    expect(newToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
    expect(matchesToken(token, hashToken(token))).toBe(true);
    expect(matchesToken(newToken(), hashToken(token))).toBe(false);
    for (const bad of ["", null, "../", "a".repeat(100)])
      expect(isToken(bad)).toBe(false);
    expect(matchesToken(token, "bad hash")).toBe(false);
  });
  it("validates Telegram signature with numeric and string fields", () => {
    const data = signed({
      last_name: "Тест",
      photo_url: "https://example.test/avatar",
    });
    expect(verifyTelegram(data, bot, now)).toMatchObject({
      telegramId: 123456789n,
      name: "Студент",
      username: "fixture",
    });
    expect(
      verifyTelegram(signed({ id: "123456789" }), bot, now),
    ).not.toBeNull();
  });
  it("rejects changes, malformed hashes, extra fields, wrong secrets and stale/future payloads", () => {
    const data = signed();
    for (const input of [
      { ...data, id: 987 },
      { ...data, first_name: "Атака" },
      { ...data, hash: "zz" },
      { ...data, hash: "a".repeat(64) },
      { ...data, unexpected: "x" },
      null,
    ])
      expect(verifyTelegram(input, bot, now)).toBeNull();
    expect(verifyTelegram(data, "wrong", now)).toBeNull();
    expect(verifyTelegram(data, "", now)).toBeNull();
    expect(
      verifyTelegram(
        signed({ auth_date: Math.floor(now.getTime() / 1000) - 86401 }),
        bot,
        now,
      ),
    ).toBeNull();
    expect(
      verifyTelegram(
        signed({ auth_date: Math.floor(now.getTime() / 1000) + 1 }),
        bot,
        now,
      ),
    ).toBeNull();
    expect(
      verifyTelegram(
        signed({ auth_date: Math.floor(now.getTime() / 1000) - 86400 }),
        bot,
        now,
      ),
    ).not.toBeNull();
  });
  it("normalizes admin list without elevating other users or demoting editors", () => {
    expect(
      adminRole("owner@example.ru", " Owner@Example.ru, other@example.ru "),
    ).toBe("ADMIN");
    expect(adminRole("not-owner@example.ru", "owner@example.ru")).toBe("USER");
    expect(adminRole(null, "owner@example.ru", "EDITOR")).toBe("EDITOR");
  });
  it("validates profile and timezone without accepting a privileged role", () => {
    const input = {
      name: " Студент ",
      university: "",
      course: "6",
      timezone: "Asia/Yekaterinburg",
    };
    expect(profileSchema.strict().parse(input)).toMatchObject({
      name: "Студент",
      course: 6,
    });
    for (const extra of [
      { name: "   " },
      { course: "7" },
      { timezone: "invalid/timezone" },
      { role: "ADMIN" },
    ])
      expect(
        profileSchema.strict().safeParse({ ...input, ...extra }).success,
      ).toBe(false);
  });
  it("uses safe setting defaults and respects valid stored values", () => {
    expect(decodeSetting("auth.maxSessions", 0)).toBe(5);
    expect(decodeSetting("auth.maxSessions", 2.5)).toBe(5);
    expect(decodeSetting("auth.sessionDays", 999999)).toBe(30);
    expect(decodeSetting("auth.maxSessions", 3)).toBe(3);
    expect(decodeSetting("lesson.passThreshold", 2)).toBe(0.7);
    expect(decodeSetting("lesson.passThreshold", 0.8)).toBe(0.8);
    expect(decodeSetting("billing.retryHours", [12, 48])).toEqual([12, 48]);
  });
});
