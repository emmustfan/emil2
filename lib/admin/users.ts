import { assignmentInclude } from "../org/service";
import { z } from "zod";
import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { getEnv } from "../env";
import { getSetting } from "../settings";
import { AuthError } from "../auth/errors";
import { ContentError } from "../content/errors";
import { lockRoleAccess } from "../auth/role-lock";
import { accessChangeError, protectedOwner, type AppRole } from "../auth/roles";
export const userFilters = z
  .object({
    q: z.string().trim().max(200).default(""),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    role: z.enum(["ALL", "USER", "EDITOR", "ADMIN"]).default("ALL"),
    state: z.enum(["ALL", "ACTIVE", "BLOCKED"]).default("ALL"),
  })
  .strict();
export const accessInput = z
  .object({
    revision: z.number().int().nonnegative(),
    role: z.enum(["USER", "EDITOR", "ADMIN"]),
    blocked: z.boolean(),
    subjectIds: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)).max(1000),
  })
  .strict()
  .refine((v) => new Set(v.subjectIds).size === v.subjectIds.length, {
    message: "Предметы не должны повторяться.",
    path: ["subjectIds"],
  })
  .refine((v) => v.role === "EDITOR" || v.subjectIds.length === 0, {
    message: "Предметы назначаются только учителю.",
    path: ["subjectIds"],
  });
export type AccessInput = z.infer<typeof accessInput>;
type Db = Prisma.TransactionClient;
export async function assertAdmin(actorId: string, db: Db = getDb()) {
  const actor = await db.user.findUnique({
    where: { id: actorId },
    select: { id: true, role: true, blockedAt: true, deletedAt: true },
  });
  if (!actor || actor.blockedAt || actor.deletedAt)
    throw new AuthError("unauthorized", 401);
  if (actor.role !== "ADMIN") throw new AuthError("forbidden", 403);
  return actor;
}
const select = {
  id: true,
  name: true,
  email: true,
  emailVerifiedAt: true,
  telegramId: true,
  telegramUsername: true,
  role: true,
  roleRevision: true,
  blockedAt: true,
  createdAt: true,
  deletedAt: true,
} as const satisfies Prisma.UserSelect;
function dto(user: Prisma.UserGetPayload<{ select: typeof select }>) {
  return {
    ...user,
    telegramId: user.telegramId?.toString() ?? null,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    blockedAt: user.blockedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    deletedAt: user.deletedAt?.toISOString() ?? null,
    owner: protectedOwner(user.email, getEnv().ADMIN_EMAILS),
  };
}
export async function listUsers(
  actorId: string,
  input: z.infer<typeof userFilters>,
) {
  await assertAdmin(actorId);
  const size = await getSetting("admin.usersPageSize");
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(input.role === "ALL" ? {} : { role: input.role }),
    ...(input.state === "BLOCKED"
      ? { blockedAt: { not: null } }
      : input.state === "ACTIVE"
        ? { blockedAt: null }
        : {}),
    ...(input.q
      ? {
          OR: [
            { name: { contains: input.q, mode: "insensitive" } },
            { email: { contains: input.q, mode: "insensitive" } },
            {
              telegramUsername: {
                contains: input.q.replace(/^@/, ""),
                mode: "insensitive",
              },
            },
            ...(/^\d{1,18}$/.test(input.q)
              ? [{ telegramId: BigInt(input.q) }]
              : []),
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    getDb().user.findMany({
      where,
      select,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (input.page - 1) * size,
      take: size,
    }),
    getDb().user.count({ where }),
  ]);
  return {
    items: rows.map(dto),
    total,
    page: input.page,
    pages: Math.max(1, Math.ceil(total / size)),
  };
}
export async function getManagedUser(actorId: string, id: string) {
  await assertAdmin(actorId);
  const user = await getDb().user.findUnique({ where: { id }, select });
  if (!user || user.deletedAt)
    throw new ContentError("Пользователь не найден.", 404);
  const [assignments, audit, subjects, staffAssignments] = await Promise.all([
    getDb().roleAssignment.findMany({
      where: { userId: id, role: "AUTHOR", subjectId: { not: null } },
      select: { subjectId: true, subject: { select: { title: true } } },
      orderBy: { subjectId: "asc" },
    }),
    getDb().securityAudit.findMany({
      where: { targetId: id },
      select: {
        id: true,
        action: true,
        changes: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
    }),
    getDb().subject.findMany({
      select: { id: true, title: true, status: true },
      orderBy: [{ order: "asc" }, { title: "asc" }],
    }),
    getDb().roleAssignment.findMany({
      where: { userId: id },
      include: {
        faculty: assignmentInclude.faculty,
        department: assignmentInclude.department,
        subject: assignmentInclude.subject,
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
  ]);
  return {
    user: dto(user),
    staffAssignments: staffAssignments.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
    assignments: assignments.flatMap((a) =>
      a.subject && a.subjectId
        ? [{ subjectId: a.subjectId, subject: a.subject }]
        : [],
    ),
    subjects,
    audit: audit.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
  };
}
export type ManagedUser = Awaited<ReturnType<typeof getManagedUser>>;
export async function updateUserAccess(
  actorId: string,
  id: string,
  input: AccessInput,
) {
  const data = accessInput.parse(input),
    max = await getSetting("admin.maxTeacherSubjects");
  if (data.subjectIds.length > max)
    throw new ContentError(`Можно назначить не больше ${max} предметов.`);
  await getDb().$transaction(async (tx) => {
    await lockRoleAccess(tx, true);
    await assertAdmin(actorId, tx);
    const target = await tx.user.findUnique({ where: { id }, select });
    if (!target || target.deletedAt)
      throw new ContentError("Пользователь не найден.", 404);
    if (target.roleRevision !== data.revision)
      throw new ContentError(
        "Доступ уже изменён другим администратором. Обновите данные.",
        409,
        [],
        "stale",
      );
    const scopedRoles = await tx.roleAssignment.count({
      where: {
        userId: id,
        OR: [{ role: { not: "AUTHOR" } }, { subjectId: null }],
      },
    });
    const nextRole =
      data.role === "ADMIN"
        ? "ADMIN"
        : data.subjectIds.length || scopedRoles
          ? "EDITOR"
          : "USER";
    const otherAdmins = await tx.user.count({
      where: {
        id: { not: id },
        role: "ADMIN",
        blockedAt: null,
        deletedAt: null,
      },
    });
    const denied = accessChangeError({
      actorId,
      targetId: id,
      currentRole: target.role,
      nextRole: data.role === "EDITOR" ? "EDITOR" : nextRole,
      blocked: data.blocked,
      owner: protectedOwner(target.email, getEnv().ADMIN_EMAILS),
      otherAdmins,
      verified: !!target.emailVerifiedAt || !!target.telegramId,
    });
    if (denied) throw new ContentError(denied, 409);
    if (
      (await tx.subject.count({ where: { id: { in: data.subjectIds } } })) !==
      data.subjectIds.length
    )
      throw new ContentError(
        "Один из выбранных предметов больше не существует.",
        409,
      );
    const assigned = await tx.roleAssignment.findMany({
        where: { userId: id, role: "AUTHOR", subjectId: { not: null } },
        select: { subjectId: true },
      }),
      before = assigned.map((a) => a.subjectId).sort(),
      after = [...data.subjectIds].sort();
    const blocked = !!target.blockedAt;
    if (
      target.role === nextRole &&
      blocked === data.blocked &&
      JSON.stringify(before) === JSON.stringify(after)
    )
      return;
    await tx.user.update({
      where: { id },
      data: {
        role: nextRole,
        blockedAt: data.blocked ? (target.blockedAt ?? new Date()) : null,
        roleRevision: { increment: 1 },
      },
    });
    await tx.roleAssignment.deleteMany({
      where: {
        userId: id,
        role: "AUTHOR",
        AND: [{ subjectId: { not: null } }, { subjectId: { notIn: after } }],
      },
    });
    for (const subjectId of after)
      await tx.roleAssignment.upsert({
        where: {
          userId_role_scopeKey: {
            userId: id,
            role: "AUTHOR",
            scopeKey: "subject:" + subjectId,
          },
        },
        create: {
          userId: id,
          role: "AUTHOR",
          subjectId,
          scopeKey: "subject:" + subjectId,
          assignedById: actorId,
        },
        update: {},
      });
    if (data.blocked) await tx.session.deleteMany({ where: { userId: id } });
    await tx.securityAudit.create({
      data: {
        actorId,
        targetId: id,
        action: "USER_ACCESS_CHANGED",
        changes: {
          before: { role: target.role, blocked, subjectIds: before },
          after: { role: nextRole, blocked: data.blocked, subjectIds: after },
        },
      },
    });
  });
  return getManagedUser(actorId, id);
}
export const roleValues: AppRole[] = ["USER", "EDITOR", "ADMIN"];
