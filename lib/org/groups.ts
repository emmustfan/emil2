import { getDb } from "../db";
import { ContentError } from "../content/errors";
import type { Prisma } from "../generated/prisma/client";
import { orgActor, type ContentReader } from "./actor";
import {
  activeDepartment,
  groupPermissions,
  groupScopes,
  teachingScope,
} from "./group-policy";
import type { GroupAction, StaffActor } from "./policy";
import { progressSubjectScope } from "./progress";

type Db = Prisma.TransactionClient;
type Group = { facultyId: string };
type Subject = { id: string; departmentId: string };
type GroupPermissions = ReturnType<typeof groupPermissions>;
export const groupMissing = () =>
  new ContentError("Группа или предмет не найдены.", 404);

export async function groupDirectory(reader: ContentReader) {
  const actor = await orgActor(reader);
  const { admin, faculties, departments } = groupScopes(actor);
  const journalScope = progressSubjectScope(actor);
  const teaching = teachingScope(actor);
  const db = getDb();
  const [groups, availableFaculties] = await Promise.all([
    db.studyGroup.findMany({
      where: admin
        ? {}
        : {
            OR: [
              { facultyId: { in: faculties } },
              { subjects: { some: journalScope } },
              {
                archivedAt: null,
                faculty: { archivedAt: null },
                ...(departments.length ? {} : { subjects: { some: teaching } }),
              },
            ],
          },
      select: {
        id: true,
        name: true,
        course: true,
        academicYear: true,
        facultyId: true,
        archivedAt: true,
        faculty: { select: { title: true, archivedAt: true } },
        subjects: {
          where: journalScope,
          select: { subject: { select: { id: true, title: true } } },
          orderBy: { subject: { title: "asc" } },
        },
      },
      orderBy: [{ academicYear: "desc" }, { name: "asc" }, { id: "asc" }],
    }),
    actor.readOnly
      ? []
      : db.faculty.findMany({
          where: {
            archivedAt: null,
            ...(admin ? {} : { id: { in: faculties } }),
          },
          select: { id: true, title: true },
          orderBy: [{ order: "asc" }, { title: "asc" }],
        }),
  ]);
  const canManageGroup = (g: (typeof groups)[number]) =>
    admin || faculties.includes(g.facultyId);
  return {
    groups: groups
      .filter((g) => canManageGroup(g) || g.subjects.length > 0)
      .map((g) => ({
        ...g,
        hasGroupPage:
          canManageGroup(g) || !(g.archivedAt || g.faculty.archivedAt),
      })),
    managementGroups: groups.filter(
      (g) => !canManageGroup(g) && !g.subjects.length,
    ),
    faculties: availableFaculties,
  };
}

export async function createGroupStatus(
  reader: ContentReader,
  facultyId: string,
  db: Db,
) {
  const actor = await orgActor(reader, db);
  const scope = groupScopes(actor);
  if (!scope.admin && !scope.faculties.includes(facultyId)) return 404;
  const accessible = await db.faculty.count({
    where: { id: facultyId, archivedAt: null },
  });
  if (!accessible) return 404;
  return actor.readOnly ? 403 : 200;
}

export async function groupAccess(
  reader: ContentReader,
  groupId: string,
  db: Db = getDb(),
) {
  const actor = await orgActor(reader, db);
  const group = await db.studyGroup.findUnique({
    where: { id: groupId },
    include: { faculty: { select: { title: true, archivedAt: true } } },
  });
  if (!group) throw groupMissing();
  const scope = groupScopes(actor);
  const teaching = teachingScope(actor);
  const oversees = scope.admin || scope.faculties.includes(group.facultyId);
  const teacher =
    !oversees && actor.role === "EDITOR"
      ? await db.groupSubject.findFirst({
          where: { groupId, ...teaching },
          select: { subjectId: true },
        })
      : null;
  const permissions = groupPermissions(actor, group, !!teacher);
  if (!permissions.read) throw groupMissing();

  const subjectScope = groupSubjectScope(actor, group);
  return {
    actor,
    group,
    permissions,
    subjectScope,
    teachingScope: teaching,
    oversees,
  };
}

function actionStatus(permissions: GroupPermissions, action: GroupAction) {
  if (action === "group.manage") return permissions.manage ? 200 : 403;
  if (!permissions.roster) return 404;
  return permissions.members ? 200 : 403;
}

export async function groupStatus(
  reader: ContentReader,
  action: GroupAction,
  groupId: string,
  db: Db,
) {
  try {
    const { permissions } = await groupAccess(reader, groupId, db);
    return actionStatus(permissions, action);
  } catch (error) {
    if (error instanceof ContentError && error.status === 404) return 404;
    throw error;
  }
}

export function assertGroupAction(
  permissions: GroupPermissions,
  action: GroupAction,
) {
  const status = actionStatus(permissions, action);
  if (status === 404) throw groupMissing();
  if (status !== 200)
    throw new ContentError("Недостаточно прав для этого действия.", status);
}

function groupSubjectScope(
  actor: StaffActor,
  group: Group,
): Prisma.SubjectWhereInput {
  const { admin, faculties, departments } = groupScopes(actor);
  return {
    department: activeDepartment,
    ...(admin || faculties.includes(group.facultyId)
      ? {}
      : { departmentId: { in: departments } }),
  };
}

export async function assertGroupSubject(
  actor: StaffActor,
  group: Group,
  subjectId: string,
  db: Db,
) {
  if (actor.readOnly) throw new ContentError("Режим просмотра.", 403);
  const subject = await db.subject.findFirst({
    where: { id: subjectId, ...groupSubjectScope(actor, group) },
    select: { id: true, departmentId: true },
  });
  if (!subject) throw groupMissing();
  return subject;
}

function teacherAreas(subjects: Subject[]): Prisma.RoleAssignmentWhereInput[] {
  return [
    { subjectId: { in: subjects.map((subject) => subject.id) } },
    {
      departmentId: {
        in: [...new Set(subjects.map((subject) => subject.departmentId))],
      },
    },
  ];
}

function eligibleTeachers(
  areas: Prisma.RoleAssignmentWhereInput[],
): Prisma.UserWhereInput {
  return {
    blockedAt: null,
    deletedAt: null,
    anonymizedAt: null,
    OR: [{ role: "ADMIN" }, { staffAssignments: { some: { OR: areas } } }],
  };
}

export async function searchGroupTeachers(subjects: Subject[], query: string) {
  const areas = teacherAreas(subjects);
  const matches =
    query && subjects.length
      ? await getDb().user.findMany({
          where: {
            AND: [
              eligibleTeachers(areas),
              {
                OR: [
                  { name: { contains: query, mode: "insensitive" } },
                  { email: { contains: query, mode: "insensitive" } },
                  {
                    telegramUsername: {
                      contains: query.replace(/^@/, ""),
                      mode: "insensitive",
                    },
                  },
                ],
              },
            ],
          },
          select: {
            id: true,
            name: true,
            email: true,
            telegramUsername: true,
            role: true,
            staffAssignments: {
              where: { OR: areas },
              select: { subjectId: true, departmentId: true },
            },
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 100,
        })
      : [];
  return new Map(
    subjects.map((subject) => [
      subject.id,
      matches
        .filter(
          (teacher) =>
            teacher.role === "ADMIN" ||
            teacher.staffAssignments.some(
              (a) =>
                a.subjectId === subject.id ||
                a.departmentId === subject.departmentId,
            ),
        )
        .map(({ id, name, email, telegramUsername }) => ({
          id,
          name,
          email,
          telegramUsername,
        })),
    ]),
  );
}

export async function assertEligibleTeacher(
  teacherId: string,
  subject: Subject,
  db: Db,
) {
  if (
    !(await db.user.count({
      where: { id: teacherId, ...eligibleTeachers(teacherAreas([subject])) },
    }))
  )
    throw new ContentError(
      "Для назначения сотрудник должен работать на кафедре или быть назначен на предмет.",
    );
}
