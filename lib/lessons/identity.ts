import type { Prisma } from "../generated/prisma/client";
import type { Actor } from "./types";
import { AuthError } from "../auth/errors";
import { getSetting } from "../settings";
import { ContentError } from "../content/errors";
import { IMPERSONATION_WRITE_MESSAGE } from "../auth/impersonation-policy";
type Db = Prisma.TransactionClient;
export function actorIdentity(actor: Actor) {
  return actor.userId
    ? { userId: actor.userId }
    : { demoSessionId: actor.demoSessionId! };
}
export function assertWritableActor(actor: Actor) {
  if (actor.readOnly) throw new ContentError(IMPERSONATION_WRITE_MESSAGE, 403);
}
export async function assertActor(actor: Actor, tx: Db) {
  if (actor.userId) {
    const user = await tx.user.findUnique({
      where: { id: actor.userId },
      select: { timezone: true, blockedAt: true, deletedAt: true },
    });
    if (!user || (user.blockedAt && !actor.readOnly) || user.deletedAt)
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
