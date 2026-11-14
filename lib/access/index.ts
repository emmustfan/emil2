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
// All reservations share atomic database counters; callers may supply a transaction.
export async function consumeLimit(
  actorKey: string,
  options?: {
    feature: string;
    max: number;
    periodStart: Date;
    db?: Prisma.TransactionClient;
  },
) {
  const max = options?.max ?? (await getSetting("lesson.requestsPerMinute"));
  const feature = options?.feature ?? "lesson";
  const periodStart =
    options?.periodStart ?? new Date(Math.floor(Date.now() / 60000) * 60000);
  const reserve = async (tx: Prisma.TransactionClient) => {
    await lock(tx, `usage:${feature}:${actorKey}`);
    const where = {
      actorKey_feature_periodStart: {
        actorKey,
        feature,
        periodStart,
      },
    };
    const row = await tx.usageCounter.findUnique({ where });
    if (row && row.count >= max)
      throw new ContentError("Слишком много запросов. Подождите минуту.", 429);
    if (row) {
      const changed = await tx.usageCounter.updateMany({
        where: { id: row.id, count: { lt: max } },
        data: { count: { increment: 1 } },
      });
      if (!changed.count)
        throw new ContentError("Лимит запросов исчерпан.", 429);
      return row.count + 1;
    }
    if (max < 1) throw new ContentError("Лимит запросов исчерпан.", 429);
    await tx.usageCounter.create({
      data: { actorKey, feature, periodStart, count: 1 },
    });
    return 1;
  };
  return options?.db ? reserve(options.db) : getDb().$transaction(reserve);
}
