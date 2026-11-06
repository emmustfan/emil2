import { cookies } from "next/headers";
import { getCurrentSession } from "../auth/server";
import { hasCurrentConsent } from "../auth/legal";
import { AuthError } from "../auth/errors";
import { hashToken, isToken } from "../auth/crypto";
import { lock } from "../auth/session";
import { getDb } from "../db";
import { getSetting } from "../settings";
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
  const token = (await cookies()).get(GUEST_COOKIE)?.value;
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
    const row =
      existing ??
      (await tx.demoSession.create({ data: { anonId, stepsCompleted: [] } }));
    return { demoSessionId: row.id };
  });
}
