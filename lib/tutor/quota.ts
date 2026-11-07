import type { Prisma } from "../generated/prisma/client";
import type { Actor } from "../lessons/types";
import { actorKey } from "../lessons/actor";
import { getDb } from "../db";
import { lock } from "../auth/session";
import { AuthError } from "../auth/errors";
import { allowsAccess } from "../access/policy";
import { getSetting } from "../settings";
import { dayWindow } from "../srs/day";
import { tutorSettings, type TutorSettings } from "./settings";
import type { Quota } from "./types";
type Db = Prisma.TransactionClient;
export async function assertActor(actor: Actor, tx: Db) {
  if (actor.userId) {
    const user = await tx.user.findUnique({
      where: { id: actor.userId },
      select: { timezone: true, blockedAt: true, deletedAt: true },
    });
    if (!user || user.blockedAt || user.deletedAt)
      throw new AuthError("unauthorized", 401);
    return user.timezone;
  }
  const demo = await tx.demoSession.findUnique({
    where: { id: actor.demoSessionId! },
    select: { userId: true, createdAt: true },
  });
  if (
    !demo ||
    demo.userId ||
    demo.createdAt.getTime() <=
      Date.now() - (await getSetting("lesson.guestDays")) * 86400000
  )
    throw new AuthError("unauthorized", 401);
  return "Europe/Moscow";
}
export async function refund(
  tx: Db,
  actor: Actor,
  messageId: string,
  token: string,
) {
  const message = await tx.tutorMessage.findFirst({
    where: {
      id: messageId,
      status: "RUNNING",
      runToken: token,
      conversation: { ...actor },
    },
  });
  if (!message?.quotaPeriodStart) return false;
  await tx.usageCounter.updateMany({
    where: {
      actorKey: actorKey(actor),
      feature: "tutor",
      periodStart: message.quotaPeriodStart,
      count: { gt: 0 },
    },
    data: { count: { decrement: 1 } },
  });
  await tx.tutorMessage.update({
    where: { id: message.id },
    data: { status: "FAILED", runToken: null, leaseUntil: null },
  });
  return true;
}
export async function recoverExpired(tx: Db, actor: Actor, now: Date) {
  const expired = await tx.tutorMessage.findMany({
    where: {
      role: "USER",
      status: "RUNNING",
      leaseUntil: { lte: now },
      conversation: { ...actor },
    },
    select: { id: true, runToken: true },
  });
  for (const m of expired)
    if (m.runToken) await refund(tx, actor, m.id, m.runToken);
}
export async function quotaState(
  tx: Db,
  actor: Actor,
  settings: TutorSettings,
  now = new Date(),
) {
  const timezone = await assertActor(actor, tx),
    window = dayWindow(now, timezone);
  let tier: Quota["tier"] = "guest",
    limit = settings.demoLimit;
  const periodStart = actor.userId ? window.start : new Date(0);
  if (actor.userId) {
    tier = "free";
    const free = await tx.plan.findUnique({
      where: { code: "free" },
      select: { tutorDailyLimit: true, isActive: true },
    });
    limit =
      free?.isActive &&
      Number.isInteger(free.tutorDailyLimit) &&
      free.tutorDailyLimit >= 0
        ? free.tutorDailyLimit
        : settings.freeDailyLimit;
    const subscriptions = await tx.subscription.findMany({
      where: { userId: actor.userId, status: { in: ["ACTIVE", "PAST_DUE"] } },
      include: { plan: true },
    });
    const grace = await getSetting("billing.graceDays");
    const active = subscriptions.filter((s) =>
      allowsAccess(
        { subjectId: s.subjectId ?? "all", isFree: false },
        { subscriptions: [s], grants: [] },
        now,
        grace,
      ),
    );
    const grants = await tx.accessGrant.count({
      where: { userId: actor.userId, expiresAt: { gt: now } },
    });
    if (active.length || grants) {
      tier = "paid";
      const limits = active
        .map((s) => s.plan.tutorDailyLimit)
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 100000);
      limit = limits.length ? Math.max(...limits) : settings.paidDailyLimit;
    }
  }
  const row = await tx.usageCounter.findUnique({
    where: {
      actorKey_feature_periodStart: {
        actorKey: actorKey(actor),
        feature: "tutor",
        periodStart,
      },
    },
  });
  const quota: Quota = {
    remaining: Math.max(0, limit - (row?.count ?? 0)),
    limit,
    resetAt: actor.userId ? window.end.toISOString() : null,
    tier,
    timeZone: window.timeZone,
  };
  return { quota, periodStart };
}
export async function getTutorQuota(actor: Actor, now = new Date()) {
  const settings = await tutorSettings();
  return getDb().$transaction(async (tx) => {
    await lock(tx, `usage:tutor:${actorKey(actor)}`);
    await recoverExpired(tx, actor, now);
    return (await quotaState(tx, actor, settings, now)).quota;
  });
}
