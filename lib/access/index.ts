import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { getSetting } from "../settings";
import { lock } from "../auth/session";
import { ContentError } from "../content/errors";
import { allowsAccess } from "./policy";
export async function hasAccess(
  userId: string | null,
  topic: { subjectId: string; isFree: boolean },
  db: Prisma.TransactionClient = getDb(),
) {
  if (topic.isFree) return true;
  if (!userId) return false;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { blockedAt: true, deletedAt: true },
  });
  if (!user || user.blockedAt || user.deletedAt) return false;
  const [subscriptions, grants, grace] = await Promise.all([
    db.subscription.findMany({
      where: { userId, status: { in: ["ACTIVE", "PAST_DUE"] } },
      include: { plan: { select: { kind: true } } },
    }),
    db.accessGrant.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      select: { subjectId: true, expiresAt: true },
    }),
    getSetting("billing.graceDays"),
  ]);
  return allowsAccess(topic, { subscriptions, grants }, new Date(), grace);
}
// Lesson reads and submissions share a database-backed per-actor minute limit.
// Tutor limits are added with the tutor stage, using the same UsageCounter table.
export async function consumeLimit(actorKey: string) {
  const max = await getSetting("lesson.requestsPerMinute");
  const periodStart = new Date(Math.floor(Date.now() / 60000) * 60000);
  await getDb().$transaction(async (tx) => {
    await lock(tx, `usage:lesson:${actorKey}`);
    const where = {
      actorKey_feature_periodStart: {
        actorKey,
        feature: "lesson",
        periodStart,
      },
    };
    const row = await tx.usageCounter.findUnique({ where });
    if (row && row.count >= max)
      throw new ContentError("Слишком много запросов. Подождите минуту.", 429);
    await tx.usageCounter.upsert({
      where,
      create: { actorKey, feature: "lesson", periodStart, count: 1 },
      update: { count: { increment: 1 } },
    });
  });
}
