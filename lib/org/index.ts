import { cache } from "react";
import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { lockRoleAccess } from "../auth/role-lock";
import { AuthError } from "../auth/errors";
import { ContentError } from "../content/errors";
import {
  decide,
  roleAllows,
  type Action,
  type Area,
  type Assignment,
} from "./policy";
export type { Action } from "./policy";
export const UNASSIGNED_DEPARTMENT_ID = "org-unassigned";

type Db = Prisma.TransactionClient;
export type ContentReader = string | { id: string; readOnly?: boolean };
type OrgActor = {
  id: string;
  role: string;
  assignments: Assignment[];
  readOnly?: boolean;
};
export type Target =
  | { subjectId: string; draftUpdatedById?: string | null; groupId?: string }
  | { departmentId: string }
  | { facultyId: string };

async function loadActor(
  db: Db,
  id: string,
  readOnly: boolean,
): Promise<OrgActor> {
  const row = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      blockedAt: true,
      deletedAt: true,
      staffAssignments: {
        select: {
          role: true,
          facultyId: true,
          departmentId: true,
          subjectId: true,
        },
      },
    },
  });
  if (!row || row.deletedAt || (row.blockedAt && !readOnly))
    throw new AuthError("unauthorized", 401);
  return {
    id: row.id,
    role: row.role,
    assignments: row.staffAssignments,
    readOnly,
  };
}

const cachedActor = cache((id: string, readOnly: boolean) =>
  loadActor(getDb(), id, readOnly),
);
const requestActors = new WeakMap<object, Promise<OrgActor>>();
export function orgActor(actor: ContentReader, db?: Db) {
  const id = typeof actor === "string" ? actor : actor.id;
  const readOnly = typeof actor === "object" && actor.readOnly === true;
  if (db && db !== getDb()) return loadActor(db, id, readOnly);
  if (typeof actor === "string") return cachedActor(id, readOnly);
  const existing = requestActors.get(actor);
  if (existing) return existing;
  const loaded = cachedActor(id, readOnly);
  requestActors.set(actor, loaded);
  return loaded;
}

async function areaFor(db: Db, target: Target): Promise<Area | null> {
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
