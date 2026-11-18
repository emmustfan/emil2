import type { Prisma } from "../generated/prisma/client";
import { getDb } from "../db";
import { AuthError } from "../auth/errors";
import { ContentError } from "./errors";
import { canEditSubject, isStaff } from "../auth/roles";
import { lockRoleAccess } from "../auth/role-lock";
// Undefined is reserved for trusted internal callers (seed/tests). HTTP and pages pass userId.
export type ContentReader = string | { id: string; readOnly?: boolean };
export async function contentActor(
  actorId: ContentReader | undefined,
  db: Prisma.TransactionClient = getDb(),
  adminOnly = false,
) {
  if (!actorId) return null;
  const readOnly = typeof actorId === "object" && actorId.readOnly;
  const id = typeof actorId === "string" ? actorId : actorId.id;
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, role: true, blockedAt: true, deletedAt: true },
  });
  if (!user || (user.blockedAt && !readOnly) || user.deletedAt)
    throw new AuthError("unauthorized", 401);
  if (!isStaff(user.role) || (adminOnly && user.role !== "ADMIN"))
    throw new AuthError("forbidden", 403);
  return user;
}
export async function authorizeSubject(
  subjectId: string,
  actorId?: ContentReader,
  db: Prisma.TransactionClient = getDb(),
) {
  const user = await contentActor(actorId, db);
  if (!user || user.role === "ADMIN") return;
  const assigned = await db.teacherSubject.count({
    where: { teacherId: user.id, subjectId },
  });
  if (!canEditSubject(user.role, assigned > 0))
    throw new ContentError("Материал не найден.", 404);
}
export async function contentWrite(
  tx: Prisma.TransactionClient,
  actorId?: string,
  adminOnly = false,
) {
  if (actorId) await lockRoleAccess(tx);
  return contentActor(actorId, tx, adminOnly);
}
