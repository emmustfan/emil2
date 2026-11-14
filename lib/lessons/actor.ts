import { cookies } from "next/headers";
import { getCurrentSession } from "../auth/server";
import { hasCurrentConsent } from "../auth/legal";
import { AuthError } from "../auth/errors";
import { hashToken, isToken } from "../auth/crypto";
import { lock } from "../auth/session";
import { getDb } from "../db";
import { getSetting } from "../settings";
import { DEMO_COOKIE } from "../analytics/identity";
import type { Prisma } from "../generated/prisma/client";
import { assertActor } from "./identity";
import type { Actor } from "./types";
export const GUEST_COOKIE = "lesson_guest";
export function actorKey(actor: Actor) {
  return actor.userId ? `user:${actor.userId}` : `demo:${actor.demoSessionId}`;
}
export async function lessonActor(): Promise<Actor> {
  const session = await getCurrentSession();
  if (session) {
    if (!(await hasCurrentConsent(session.user)))
      throw new AuthError("forbidden", 403);
    return { userId: session.userId };
  }
  const jar = await cookies();
  const demo = await guestDemo(
    jar.get(DEMO_COOKIE)?.value ?? jar.get(GUEST_COOKIE)?.value,
  );
  return { demoSessionId: demo.id };
}
export async function lockLearningActor(
  tx: Prisma.TransactionClient,
  actor: Actor,
) {
  await lock(tx, `learning:${actorKey(actor)}`);
  await assertActor(actor, tx);
}
export async function guestDemo(token?: string) {
  if (!isToken(token)) throw new AuthError("unauthorized", 401);
  const anonId = hashToken(token!);
  const days = await getSetting("lesson.guestDays");
  return getDb().$transaction(async (tx) => {
    await lock(tx, `lesson-guest:${anonId}`);
    const existing = await tx.demoSession.findFirst({
      where: {
        anonId,
        userId: null,
        createdAt: { gt: new Date(Date.now() - days * 86400000) },
      },
      orderBy: { createdAt: "desc" },
    });
    return (
      existing ??
      tx.demoSession.create({ data: { anonId, stepsCompleted: [] } })
    );
  });
}
