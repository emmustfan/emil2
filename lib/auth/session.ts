import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { getEnv } from "../env";
import { getSetting } from "../settings";
import { hashToken, isToken, newToken } from "./crypto";
import { AuthError } from "./errors";
export const SID = "sid";
export const LOGIN_FLOW = "login_flow";
export function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure:
      getEnv().APP_URL.startsWith("https://") ||
      getEnv().NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}
export async function lock(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
export async function createSession(
  tx: Prisma.TransactionClient,
  userId: string,
  days: number,
  maxSessions: number,
) {
  await lock(tx, `sessions:${userId}`);
  const token = newToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 86400000);
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.blockedAt || user.deletedAt) throw new AuthError("invalid");
  await tx.session.deleteMany({ where: { userId, expiresAt: { lte: now } } });
  const older = await tx.session.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: maxSessions - 1,
    select: { id: true },
  });
  if (older.length)
    await tx.session.deleteMany({
      where: { id: { in: older.map((s) => s.id) } },
    });
  await tx.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });
  return { token, expiresAt, user };
}
export async function findSession(token?: string, renew = false) {
  if (!isToken(token)) return null;
  const db = getDb();
  const now = new Date();
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (
    !session ||
    session.expiresAt <= now ||
    session.user.blockedAt ||
    session.user.deletedAt
  )
    return null;
  if (
    renew &&
    session.lastSeenAt.getTime() <
      now.getTime() - (await getSetting("auth.refreshHours")) * 3600000
  ) {
    const expiresAt = new Date(
      now.getTime() + (await getSetting("auth.sessionDays")) * 86400000,
    );
    const changed = await db.session.updateMany({
      where: {
        id: session.id,
        lastSeenAt: session.lastSeenAt,
        expiresAt: { gt: now },
      },
      data: { lastSeenAt: now, expiresAt },
    });
    if (changed.count) return { ...session, expiresAt, renewed: true as const };
    // Revocation/parallel refresh must not revive an old cookie.
    return findSession(token, false);
  }
  return { ...session, renewed: false as const };
}
export async function sessionLimits() {
  return {
    days: await getSetting("auth.sessionDays"),
    max: await getSetting("auth.maxSessions"),
  };
}
