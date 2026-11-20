import type { Prisma } from "../generated/prisma/client";
import { getDb } from "../db";
import { ContentError } from "../content/errors";
import { hasCurrentConsent } from "../auth/legal";
import { can, type ContentReader, type Target } from "../org";

const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
export type GroupSubject = { groupId: string; subjectId: string };
type Db = Prisma.TransactionClient;

export function progressNotFound(): never {
  throw new ContentError("Данные не найдены.", 404);
}

async function assertProgressAccess(
  actor: ContentReader | null | undefined,
  target: Target,
  db: Db,
) {
  if (!actor || (typeof actor === "object" && actor.readOnly))
    return progressNotFound();
  const id = typeof actor === "string" ? actor : actor.id;
  const viewer = await db.user.findUnique({
    where: { id },
    select: {
      deletedAt: true,
      anonymizedAt: true,
      blockedAt: true,
      consentPdAt: true,
      consentPdVersion: true,
      offerVersion: true,
    },
  });
  if (
    !viewer ||
    viewer.deletedAt ||
    viewer.anonymizedAt ||
    viewer.blockedAt ||
    !(await hasCurrentConsent(viewer)) ||
    !(await can(actor, "progress.view", target, db))
  )
    return progressNotFound();
}

export async function assertCanViewGroupProgress(
  actor: ContentReader | null | undefined,
  scope: GroupSubject,
  db: Db = getDb(),
) {
  if (!idPattern.test(scope.groupId) || !idPattern.test(scope.subjectId))
    return progressNotFound();
  await assertProgressAccess(actor, scope, db);
}

export async function assertCanViewStudent(
  viewer: ContentReader | null | undefined,
  studentId?: string,
  subjectId?: string,
  db: Db = getDb(),
  groupId?: string,
) {
  if (groupId !== undefined) {
    if (!subjectId || !studentId) return progressNotFound();
    await assertCanViewGroupProgress(viewer, { groupId, subjectId }, db);
  } else {
    await assertProgressAccess(viewer, { allProgress: true }, db);
  }
  if (studentId === undefined) return null;
  if (
    !idPattern.test(studentId) ||
    (subjectId !== undefined &&
      (typeof subjectId !== "string" || !idPattern.test(subjectId)))
  )
    return progressNotFound();
  const student = await db.user.findFirst({
    where: {
      id: studentId,
      role: "USER",
      ...(groupId
        ? {
            groupMemberships: {
              some: { groupId, status: { in: ["ACTIVE", "REMOVED"] } },
            },
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      firstName: true,
      lastName: true,
      middleName: true,
      studentNumber: true,
      deletedAt: true,
      anonymizedAt: true,
      timezone: true,
      createdAt: true,
    },
  });
  if (!student) return progressNotFound();
  if (
    !groupId &&
    subjectId &&
    !(await db.subject.count({ where: { id: subjectId } }))
  )
    return progressNotFound();

  const { lastName, firstName, middleName, ...profile } = student;
  const deleted = profile.deletedAt || profile.anonymizedAt;
  const fullName = [lastName, firstName, middleName].filter(Boolean).join(" ");
  return {
    ...profile,
    canViewAllSubjects: groupId === undefined,
    name: deleted
      ? "Удалённый пользователь"
      : (groupId && fullName) || student.name,
    email: deleted ? null : student.email,
    studentNumber: deleted ? null : student.studentNumber,
  };
}
