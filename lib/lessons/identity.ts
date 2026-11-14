import type { Prisma } from "../generated/prisma/client";
import type { Actor } from "./types";
import { AuthError } from "../auth/errors";
import { getSetting } from "../settings";
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
