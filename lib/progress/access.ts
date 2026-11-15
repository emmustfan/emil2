import type { Prisma } from "../generated/prisma/client";
import { getDb } from "../db";
import { ContentError } from "../content/errors";
import { hasCurrentConsent } from "../auth/legal";
export function progressNotFound(): never {
  throw new ContentError("Данные не найдены.", 404);
}
/** The sole policy boundary; later stages replace it with org progress.view. */
export async function assertCanViewStudent(
  viewerId: string | null | undefined,
  studentId?: string,
  subjectId?: string,
  db: Prisma.TransactionClient = getDb(),
) {
  if (!viewerId) return progressNotFound();
  const viewer = await db.user.findUnique({ where: { id: viewerId } });
  if (
    !viewer ||
    viewer.role !== "ADMIN" ||
    viewer.blockedAt ||
    viewer.deletedAt ||
    !(await hasCurrentConsent(viewer))
  )
    return progressNotFound();
  if (!studentId) return null;
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(studentId) ||
    (subjectId !== undefined &&
      (typeof subjectId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(subjectId)))
  )
    return progressNotFound();
  const student = await db.user.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      name: true,
      email: true,
      deletedAt: true,
      anonymizedAt: true,
      role: true,
      timezone: true,
      createdAt: true,
    },
  });
  if (!student || student.role !== "USER") return progressNotFound();
  if (subjectId && !(await db.subject.count({ where: { id: subjectId } })))
    return progressNotFound();
  return {
    ...student,
    canViewAllSubjects: true,
    name:
      student.deletedAt || student.anonymizedAt
        ? "Удалённый пользователь"
        : student.name,
    email: student.deletedAt || student.anonymizedAt ? null : student.email,
  };
}
