import { z } from "zod";
import { getDb } from "../db";
import { lockRoleAccess } from "../auth/role-lock";
import { ContentError } from "../content/errors";
import type { Prisma } from "../generated/prisma/client";
import { assertCan, orgActor, type ContentReader } from "./index";

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const fields = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    order: z.coerce.number().int().min(0).max(2147483647),
    archived: z.boolean().default(false),
  })
  .strict();
const assignmentInput = z
  .object({
    userId: identifier,
    role: z.enum(["FACULTY_ADMIN", "DEPARTMENT_HEAD", "AUTHOR", "REVIEWER"]),
    scope: z.enum(["faculty", "department", "subject"]),
    scopeId: identifier,
  })
  .strict();
type Db = Prisma.TransactionClient;
const missing = () => new ContentError("Материал не найден.", 404);
const denied = () =>
  new ContentError("Недостаточно прав для этого действия.", 403);
const verified = {
  OR: [
    { email: { not: null }, emailVerifiedAt: { not: null } },
    { telegramId: { not: null } },
  ],
} satisfies Prisma.UserWhereInput;

export async function saveFaculty(
  actorId: string,
  id: string | null,
  raw: unknown,
) {
  const { archived, ...data } = fields.parse(raw);
  return getDb().$transaction(async (tx) => {
    await lockRoleAccess(tx, true);
    if (id) await assertCan(actorId, "faculty.manage", { facultyId: id }, tx);
    const actor = await orgActor(actorId, tx);
    if (actor.role !== "ADMIN" && (!id || archived)) throw denied();
    if (
      id &&
      archived &&
      (await tx.department.count({
        where: { facultyId: id, archivedAt: null },
      }))
    )
      throw new ContentError(
        "Сначала архивируйте действующие кафедры факультета.",
        409,
      );
    if (
      id &&
      archived &&
      (await tx.studyGroup.count({
        where: { facultyId: id, archivedAt: null },
      }))
    )
      throw new ContentError(
        "Сначала архивируйте действующие учебные группы факультета.",
        409,
      );
    const row = { ...data, archivedAt: archived ? new Date() : null };
    return id
      ? tx.faculty.update({ where: { id }, data: row })
      : tx.faculty.create({ data: row });
  });
}

export async function saveDepartment(
  actorId: string,
  id: string | null,
  raw: unknown,
) {
  const { archived, facultyId, requireSeparateReviewer, ...data } = fields
    .extend({
      facultyId: identifier,
      requireSeparateReviewer: z.boolean().default(false),
    })
    .parse(raw);
  return getDb().$transaction(async (tx) => {
    await lockRoleAccess(tx, true);
    await assertCan(actorId, "faculty.manage", { facultyId }, tx);
    const f = await tx.faculty.findUnique({ where: { id: facultyId } });
    if (!f || f.archivedAt) throw missing();
    if (id && !(await tx.department.count({ where: { id, facultyId } })))
      throw missing();
    if (
      id &&
      archived &&
      (await tx.subject.count({
        where: { departmentId: id, status: "PUBLISHED" },
      }))
    )
      throw new ContentError(
        "Нельзя архивировать кафедру с опубликованными предметами.",
        409,
      );
    const row = {
      ...data,
      requireSeparateReviewer,
      archivedAt: archived ? new Date() : null,
    };
    return id
      ? tx.department.update({ where: { id }, data: row })
      : tx.department.create({ data: { ...row, facultyId } });
  });
}

export async function updateReviewerRule(
  actorId: string,
  id: string,
  raw: unknown,
) {
  const { requireSeparateReviewer } = z
    .object({ requireSeparateReviewer: z.boolean() })
    .strict()
    .parse(raw);
  return getDb().$transaction(async (tx) => {
    await lockRoleAccess(tx, true);
    await assertCan(actorId, "department.staff", { departmentId: id }, tx);
    return tx.department.update({
      where: { id },
      data: { requireSeparateReviewer },
    });
  });
}

async function assignmentScope(
  db: Db,
  actorId: string,
  input: z.infer<typeof assignmentInput>,
) {
  const { role, scope, scopeId } = input;
  if (role === "FACULTY_ADMIN" && scope === "faculty") {
    await assertCan(actorId, "faculty.manage", { facultyId: scopeId }, db);
    if ((await orgActor(actorId, db)).role !== "ADMIN") throw denied();
    return { facultyId: scopeId };
  }
  if (role === "DEPARTMENT_HEAD" && scope === "department") {
    const row = await db.department.findUnique({ where: { id: scopeId } });
    if (!row) throw missing();
    await assertCan(
      actorId,
      "faculty.manage",
      { facultyId: row.facultyId },
      db,
    );
    return { departmentId: scopeId };
  }
  if (role !== "AUTHOR" && role !== "REVIEWER") throw denied();
  if (scope === "department") {
    await assertCan(actorId, "department.staff", { departmentId: scopeId }, db);
    return { departmentId: scopeId };
  }
  if (scope === "subject") {
    const row = await db.subject.findUnique({
      where: { id: scopeId },
      select: { departmentId: true },
    });
    if (!row) throw missing();
    await assertCan(
      actorId,
      "department.staff",
      { departmentId: row.departmentId },
      db,
    );
    return { subjectId: scopeId };
  }
  throw denied();
}

export async function syncStaffRole(db: Db, userId: string) {
  const [user, count] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true },
    }),
    db.roleAssignment.count({ where: { userId } }),
  ]);
  await db.user.update({
    where: { id: userId },
    data: {
      role: user.role === "ADMIN" ? "ADMIN" : count ? "EDITOR" : "USER",
      roleRevision: { increment: 1 },
    },
  });
}

export async function changeAssignment(
  actorId: string,
  raw: unknown,
  remove = false,
) {
  const input = assignmentInput.parse(raw);
  return getDb().$transaction(async (tx) => {
    await lockRoleAccess(tx, true);
    const area = await assignmentScope(tx, actorId, input);
    if (
      !remove &&
      !(await tx.user.count({
        where: {
          id: input.userId,
          deletedAt: null,
          anonymizedAt: null,
          blockedAt: null,
          ...verified,
        },
      }))
    )
      throw new ContentError(
        "Для назначения нужен активный пользователь с подтверждённой почтой или Telegram.",
        422,
      );
    const scopeKey = input.scope + ":" + input.scopeId;
    const key = { userId: input.userId, role: input.role, scopeKey };
    const exists = await tx.roleAssignment.findUnique({
      where: { userId_role_scopeKey: key },
    });
    if (remove && !exists) return;
    if (!remove && exists) return;
    if (remove) await tx.roleAssignment.delete({ where: { id: exists!.id } });
    else
      await tx.roleAssignment.create({
        data: { ...key, ...area, assignedById: actorId },
      });
    await syncStaffRole(tx, input.userId);
    const scopeTitle = (
      input.scope === "faculty"
        ? await tx.faculty.findUnique({
            where: { id: input.scopeId },
            select: { title: true },
          })
        : input.scope === "department"
          ? await tx.department.findUnique({
              where: { id: input.scopeId },
              select: { title: true },
            })
          : await tx.subject.findUnique({
              where: { id: input.scopeId },
              select: { title: true },
            })
    )?.title;
    await tx.securityAudit.create({
      data: {
        actorId,
        targetId: input.userId,
        action: remove ? "STAFF_ROLE_REVOKED" : "STAFF_ROLE_ASSIGNED",
        changes: {
          role: input.role,
          scopeKey,
          scopeTitle: scopeTitle ?? scopeKey,
        },
      },
    });
  });
}

export const staffUserSelect = { id: true, name: true, email: true } as const;
export const assignmentInclude = {
  user: { select: staffUserSelect },
  faculty: { select: { title: true } },
  department: { select: { title: true } },
  subject: { select: { title: true } },
} as const;

export async function searchStaff(
  actor: ContentReader,
  departmentId: string,
  q: string,
) {
  await assertCan(actor, "department.staff", { departmentId });
  return searchVerifiedUsers(q);
}

export async function searchVerifiedUsers(q: string) {
  const query = typeof q === "string" ? q.trim().slice(0, 200) : "";
  if (!query) return [];
  return getDb().user.findMany({
    where: {
      blockedAt: null,
      deletedAt: null,
      anonymizedAt: null,
      AND: [
        verified,
        {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        },
      ],
    },
    select: staffUserSelect,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 20,
  });
}

export async function departmentStaff(
  actor: ContentReader,
  id: string,
  q: string,
) {
  await assertCan(actor, "department.staff", { departmentId: id });
  const db = getDb();
  const [department, assignments, people] = await Promise.all([
    db.department.findUniqueOrThrow({
      where: { id },
      include: {
        faculty: true,
        subjects: {
          select: { id: true, title: true },
          orderBy: { title: "asc" },
        },
      },
    }),
    db.roleAssignment.findMany({
      where: { OR: [{ departmentId: id }, { subject: { departmentId: id } }] },
      include: assignmentInclude,
      orderBy: { createdAt: "asc" },
    }),
    searchStaff(actor, id, q),
  ]);
  return { department, assignments, people };
}
