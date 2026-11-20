import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { lockRoleAccess } from "../auth/role-lock";
import { AuthError } from "../auth/errors";
import { ContentError } from "../content/errors";
import { decide, roleAllows, type Action, type Area } from "./policy";
import { orgActor, type ContentReader } from "./actor";
import { createGroupStatus, groupStatus } from "./groups";
import { progressSubjectScope } from "./progress";
export { orgActor, type ContentReader } from "./actor";
export type { Action } from "./policy";
export const UNASSIGNED_DEPARTMENT_ID = "org-unassigned";

type Db = Prisma.TransactionClient;
type ContentTarget =
  | { subjectId: string; draftUpdatedById?: string | null }
  | { departmentId: string }
  | { facultyId: string };
export type Target =
  | ContentTarget
  | { groupId: string; subjectId?: string }
  | { allProgress: true };

async function areaFor(db: Db, target: ContentTarget): Promise<Area | null> {
  const select = {
    id: true,
    facultyId: true,
    requireSeparateReviewer: true,
    archivedAt: true,
    faculty: { select: { archivedAt: true } },
  } as const;
  if ("subjectId" in target) {
    const row = await db.subject.findUnique({
      where: { id: target.subjectId },
      select: { department: { select } },
    });
    const d = row?.department;
    if (!d) return null;
    return {
      subjectId: target.subjectId,
      departmentId: d.id,
      facultyId: d.facultyId,
      archived: !!(d.archivedAt || d.faculty.archivedAt),
      requireSeparateReviewer: d.requireSeparateReviewer,
      draftUpdatedById: target.draftUpdatedById,
    };
  }
  if ("departmentId" in target) {
    const d = await db.department.findUnique({
      where: { id: target.departmentId },
      select,
    });
    return d
      ? {
          departmentId: d.id,
          facultyId: d.facultyId,
          archived: !!(d.archivedAt || d.faculty.archivedAt),
        }
      : null;
  }
  const f = await db.faculty.findUnique({
    where: { id: target.facultyId },
    select: { id: true, archivedAt: true },
  });
  return f ? { facultyId: f.id, archived: !!f.archivedAt } : null;
}

async function decision(
  actor: ContentReader,
  action: Action,
  target: Target,
  db?: Db,
) {
  if (action === "progress.view") {
    const conn = db ?? getDb();
    const user = await orgActor(actor, db);
    if ("allProgress" in target)
      return user.role === "ADMIN" && !user.readOnly ? 200 : 404;
    if (!("groupId" in target) || !target.subjectId) return 404;
    const pair = await conn.groupSubject.count({
      where: {
        AND: [
          { groupId: target.groupId, subjectId: target.subjectId },
          progressSubjectScope(user),
        ],
      },
    });
    return pair ? 200 : 404;
  }
  if (action === "group.manage" || action === "group.members") {
    const conn = db ?? getDb();
    if ("groupId" in target)
      return groupStatus(actor, action, target.groupId, conn);
    if (action === "group.manage" && "facultyId" in target)
      return createGroupStatus(actor, target.facultyId, conn);
    return 404;
  }
  if ("groupId" in target || "allProgress" in target) return 404;
  const [user, area] = await Promise.all([
    orgActor(actor, db),
    areaFor(db ?? getDb(), target),
  ]);
  return area ? decide(user, action, area) : 404;
}

export async function can(
  actor: ContentReader,
  action: Action,
  target: Target,
  db?: Db,
) {
  return (await decision(actor, action, target, db)) === 200;
}

export async function assertCan(
  actor: ContentReader,
  action: Action,
  target: Target,
  db?: Db,
) {
  const result = await decision(actor, action, target, db);
  if (result === 404) throw new ContentError("Материал не найден.", 404);
  if (result === 403)
    throw new ContentError("Недостаточно прав для этого действия.", 403);
}

// Undefined is reserved for trusted seed, scripts, tests and authorized internal reads.
export async function assertContent(
  actor: ContentReader | undefined,
  action: Action,
  target: Target,
  db?: Db,
) {
  if (actor !== undefined) await assertCan(actor, action, target, db);
}
export async function lockContentStaff(db: Db, actor?: string) {
  if (actor !== undefined) await lockRoleAccess(db);
}
export async function subjectScope(
  actor: ContentReader | undefined,
  action: Action,
): Promise<Prisma.SubjectWhereInput> {
  if (actor === undefined) return {};
  const user = await orgActor(actor);
  if (user.readOnly && action !== "content.read") return { id: { in: [] } };
  if (user.role === "ADMIN") return {};
  if (user.role !== "EDITOR") return { id: { in: [] } };
  const scopes = user.assignments.filter((a) => roleAllows(a.role, action));
  if (!scopes.length) return { id: { in: [] } };
  return {
    department: { archivedAt: null, faculty: { archivedAt: null } },
    OR: scopes.map((a) => ({
      ...(a.subjectId
        ? { id: a.subjectId }
        : a.departmentId
          ? { departmentId: a.departmentId }
          : { department: { facultyId: a.facultyId! } }),
      ...(action === "content.publish" && a.role === "AUTHOR"
        ? {
            department: {
              requireSeparateReviewer: false,
              ...(a.facultyId ? { facultyId: a.facultyId } : {}),
            },
          }
        : {}),
    })),
  };
}

export async function departmentScope(
  actor: ContentReader,
  action: Action,
): Promise<Prisma.DepartmentWhereInput> {
  const user = await orgActor(actor);
  if (user.readOnly && action !== "content.read") return { id: { in: [] } };
  if (user.role === "ADMIN") return { id: { not: "" } };
  if (user.role !== "EDITOR") return { id: { in: [] } };
  const scopes = user.assignments.filter(
    (a) => !a.subjectId && roleAllows(a.role, action),
  );
  if (!scopes.length) return { id: { in: [] } };
  return {
    archivedAt: null,
    faculty: { archivedAt: null },
    OR: scopes.map((a) =>
      a.departmentId ? { id: a.departmentId } : { facultyId: a.facultyId! },
    ),
  };
}

export async function managedFacultyIds(actor: ContentReader) {
  const user = await orgActor(actor);
  return user.role === "EDITOR" && !user.readOnly
    ? user.assignments
        .filter((a) => a.facultyId && roleAllows(a.role, "faculty.manage"))
        .map((a) => a.facultyId!)
    : [];
}
export async function assertPlatformAdmin(actor: ContentReader, db?: Db) {
  const user = await orgActor(actor, db);
  if (user.role !== "ADMIN" || user.readOnly)
    throw new AuthError("forbidden", 403);
}
