import { getDb } from "../db";
import { getEnv } from "../env";
import { getSetting } from "../settings";
import { verifyTelegram } from "./telegram";
import { AuthError } from "./errors";
import { createSession, sessionLimits } from "./session";
export async function loginTelegram(
  data: unknown,
  intentUserId: string | null,
) {
  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_USERNAME)
    throw new AuthError("unavailable", 503);
  const verified = verifyTelegram(
    data,
    env.TELEGRAM_BOT_TOKEN,
    new Date(),
    await getSetting("auth.telegramMaxAgeSeconds"),
  );
  if (!verified) throw new AuthError("invalid");
  const limits = await sessionLimits();
  return getDb().$transaction(async (tx) => {
    const replay = await tx.telegramAuthUse.findUnique({
      where: { hash: verified.hash },
    });
    if (replay) throw new AuthError("invalid");
    await tx.telegramAuthUse.create({
      data: { hash: verified.hash, expiresAt: verified.expiresAt },
    });
    const existing = await tx.user.findUnique({
      where: { telegramId: verified.telegramId },
    });
    if (intentUserId && existing && existing.id !== intentUserId)
      throw new AuthError("conflict", 409);
    const target = intentUserId
      ? await tx.user.findUniqueOrThrow({ where: { id: intentUserId } })
      : existing;
    if (target?.deletedAt || target?.blockedAt) throw new AuthError("invalid");
    if (
      intentUserId &&
      target?.telegramId &&
      target.telegramId !== verified.telegramId
    )
      throw new AuthError("conflict", 409);
    const user = target
      ? await tx.user.update({
          where: { id: target.id },
          data: {
            telegramId: verified.telegramId,
            telegramUsername: verified.username ?? null,
          },
        })
      : await tx.user.create({
          data: {
            telegramId: verified.telegramId,
            telegramUsername: verified.username,
            name: verified.name,
          },
        });
    return createSession(tx, user.id, limits.days, limits.max);
  });
}
