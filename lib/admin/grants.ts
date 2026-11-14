import { getDb } from "../db";
import { billingLock } from "../billing/service";
import { assertAdmin } from "./users";
import { adminAudit } from "./write";
import { grantInput } from "./policy";
import { ContentError } from "../content/errors";
import { getSetting } from "../settings";
export async function grantAccess(
  actorId: string,
  userId: string,
  raw: unknown,
  now = new Date(),
) {
  const input = grantInput.parse(raw);
  if (input.days > (await getSetting("admin.maxGrantDays")))
    throw new ContentError("Срок превышает разрешённый лимит ручного доступа.");
  return getDb().$transaction(async (tx) => {
    await billingLock(tx, userId);
    await assertAdmin(actorId, tx);
    const existing = await tx.accessGrant.findUnique({
      where: { id: input.requestId },
    });
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.grantedById !== actorId ||
        existing.subjectId !== input.subjectId ||
        existing.reason !== input.reason ||
        existing.expiresAt.getTime() - existing.createdAt.getTime() !==
          input.days * 86400000
      )
        throw new ContentError(
          "Запрос уже использован для другого доступа.",
          409,
        );
      return existing;
    }
    if (
      input.subjectId &&
      !(await tx.subject.count({ where: { id: input.subjectId } }))
    )
      throw new ContentError("Предмет не найден.", 404);
    const row = await tx.accessGrant.create({
      data: {
        id: input.requestId,
        userId,
        subjectId: input.subjectId,
        expiresAt: new Date(+now + input.days * 86400000),
        reason: input.reason,
        grantedById: actorId,
        createdAt: now,
      },
    });
    await adminAudit(
      tx,
      actorId,
      "ACCESS_GRANTED",
      {
        grantId: row.id,
        subjectId: row.subjectId,
        days: input.days,
        reason: input.reason,
      },
      userId,
    );
    return row;
  });
}
export async function revokeGrant(
  actorId: string,
  userId: string,
  id: string,
  now = new Date(),
) {
  await getDb().$transaction(async (tx) => {
    await billingLock(tx, userId, true);
    await assertAdmin(actorId, tx);
    const row = await tx.accessGrant.findFirst({ where: { id, userId } });
    if (!row) throw new ContentError("Доступ не найден.", 404);
    if (row.expiresAt <= now) return;
    await tx.accessGrant.update({ where: { id }, data: { expiresAt: now } });
    await adminAudit(tx, actorId, "ACCESS_REVOKED", { grantId: id }, userId);
  });
}
