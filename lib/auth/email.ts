import { getDb } from "../db";
import { getEnv } from "../env";
import { getSetting } from "../settings";
import { createMailTransport } from "../mail";
import { hashToken, isToken, matchesToken, newToken } from "./crypto";
import { adminRole } from "./validation";
import { lockRoleAccess } from "./role-lock";
import { AuthError } from "./errors";
import { createSession, lock, sessionLimits } from "./session";
import { authRu } from "../i18n/ru";
export async function requestEmail(
  email: string,
  ip: string,
  flow: string,
  intentUserId: string | null,
) {
  const db = getDb();
  const now = new Date();
  const token = newToken();
  const [minutes, emailMinutes, emailMax, ipMinutes, ipMax, resend] =
    await Promise.all([
      getSetting("auth.tokenMinutes"),
      getSetting("auth.emailWindowMinutes"),
      getSetting("auth.emailMaxRequests"),
      getSetting("auth.ipWindowMinutes"),
      getSetting("auth.ipMaxRequests"),
      getSetting("auth.resendSeconds"),
    ]);
  const expiresAt = new Date(now.getTime() + minutes * 60000);
  await db.$transaction(async (tx) => {
    for (const key of [`auth-email:${email}`, `auth-ip:${ip}`].sort())
      await lock(tx, key);
    const emailWhere = {
      email,
      createdAt: { gte: new Date(now.getTime() - emailMinutes * 60000) },
    };
    const [byEmail, byIp, last] = await Promise.all([
      tx.loginToken.count({ where: emailWhere }),
      tx.loginToken.count({
        where: {
          ip,
          createdAt: { gte: new Date(now.getTime() - ipMinutes * 60000) },
        },
      }),
      tx.loginToken.findFirst({
        where: { email },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (
      byEmail >= emailMax ||
      byIp >= ipMax ||
      (last && now.getTime() - last.createdAt.getTime() < resend * 1000)
    )
      throw new AuthError("rate", 429);
    await tx.loginToken.create({
      data: {
        email,
        ip,
        tokenHash: hashToken(token),
        expiresAt,
        requestNonceHash: hashToken(flow),
        intentUserId,
      },
    });
  });
  const url = new URL("/auth/verify", getEnv().APP_URL);
  url.searchParams.set("token", token);
  try {
    await createMailTransport(getEnv()).send({
      to: email,
      subject: authRu.mailSubject,
      text: `${authRu.mailBody}\n${authRu.mailTtl} ${minutes} ${authRu.minutes}\n\n${url.toString()}\n\n${authRu.mailIgnore}`,
    });
  } catch {
    await db.loginToken.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { usedAt: new Date() },
    });
    throw new AuthError("unavailable", 503);
  }
  return expiresAt;
}
export async function verifyEmail(
  token: string,
  flow: string | undefined,
  currentUserId: string | null,
) {
  if (!isToken(token) || !isToken(flow)) throw new AuthError("invalid");
  const db = getDb();
  const limits = await sessionLimits();
  return db.$transaction(async (tx) => {
    await lockRoleAccess(tx);
    await lock(tx, `login-token:${hashToken(token)}`);
    const record = await tx.loginToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    const now = new Date();
    if (
      !record ||
      record.usedAt ||
      record.expiresAt <= now ||
      !matchesToken(flow, record.requestNonceHash)
    )
      throw new AuthError("invalid");
    if (record.intentUserId && record.intentUserId !== currentUserId)
      throw new AuthError("conflict", 409);
    const existing = await tx.user.findUnique({
      where: { email: record.email },
    });
    if (record.intentUserId && existing && existing.id !== record.intentUserId)
      throw new AuthError("conflict", 409);
    if (!record.intentUserId && currentUserId && existing?.id !== currentUserId)
      throw new AuthError("conflict", 409);
    const target = record.intentUserId
      ? await tx.user.findUniqueOrThrow({ where: { id: record.intentUserId } })
      : existing;
    if (target?.blockedAt || target?.deletedAt) throw new AuthError("invalid");
    const claimed = await tx.loginToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw new AuthError("invalid");
    const user = target
      ? await tx.user.update({
          where: { id: target.id },
          data: {
            email: record.email,
            emailVerifiedAt: now,
            role: adminRole(record.email, getEnv().ADMIN_EMAILS, target.role),
          },
        })
      : await tx.user.create({
          data: {
            email: record.email,
            emailVerifiedAt: now,
            role: adminRole(record.email, getEnv().ADMIN_EMAILS),
          },
        });
    if (record.intentUserId) {
      await lock(tx, `sessions:${user.id}`);
      await tx.session.deleteMany({ where: { userId: user.id } });
    }
    return createSession(tx, user.id, limits.days, limits.max);
  });
}
