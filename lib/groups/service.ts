import { randomInt } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db";
import { getSetting } from "../settings";
import { consumeLimit } from "../access";
import { AuthError } from "../auth/errors";
import { lockRoleAccess } from "../auth/role-lock";
import { lock } from "../auth/session";
import { ContentError } from "../content/errors";
import type { Prisma } from "../generated/prisma/client";
import {
  assertGroupAction,
  assertEligibleTeacher,
  assertGroupSubject,
  groupAccess,
  groupMissing,
} from "../org/groups";
import { assertCan, type ContentReader } from "../org";
import { currentGroupNotice } from "./notice";
import {
  groupFields,
  groupId,
  JOIN_ALPHABET,
  normalizeJoinCode,
} from "./input";
import { parseGroupCsv } from "./csv";

type Db = Prisma.TransactionClient;
const archivedError = () => new ContentError("Группа архивирована.", 409);
const denied = () =>
  new ContentError("Недостаточно прав для этого действия.", 403);
const invalidCode = () => new ContentError("Код недействителен.", 422);
export const GROUP_CSV_BYTES = 256 * 1024;

export async function createGroup(actor: ContentReader, raw: unknown) {
  const { facultyId, ...fields } = groupFields
    .extend({
      facultyId: groupId,
      requireApproval: z.boolean().default(true),
    })
    .parse(raw);
  return getDb().$transaction(async (tx) => {
    await lockRoleAccess(tx);
    await assertCan(actor, "group.manage", { facultyId }, tx);
    const rows = await tx.studyGroup.createManyAndReturn({
      data: { ...fields, facultyId },
      skipDuplicates: true,
      select: { id: true },
    });
    if (!rows.length)
      throw new ContentError(
        "Группа с таким названием и учебным годом уже существует на факультете.",
        409,
      );
    return rows[0];
  });
}

export async function importGroups(actor: ContentReader, raw: unknown) {
  const { facultyId, csv } = z
    .object({
      facultyId: groupId,
      csv: z.string().max(GROUP_CSV_BYTES),
    })
    .strict()
    .parse(raw);
  if (Buffer.byteLength(csv) > GROUP_CSV_BYTES)
    throw new ContentError("CSV-файл слишком большой.");
  return getDb().$transaction(async (tx) => {
    await lockRoleAccess(tx);
    await assertCan(actor, "group.manage", { facultyId }, tx);
    const { rows, duplicates, errors } = parseGroupCsv(csv);
    const { count: created } = rows.length
      ? await tx.studyGroup.createMany({
          data: rows.map((row) => ({ ...row, facultyId })),
          skipDuplicates: true,
        })
      : { count: 0 };
    return { created, duplicates: duplicates + rows.length - created, errors };
  });
}

async function lockGroup(tx: Db, id: string) {
  await lock(tx, `study-group:${id}`);
}

const staffCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("archive") }).strict(),
  z.object({ action: z.literal("rotate-code") }).strict(),
  z
    .object({ action: z.literal("approval"), requireApproval: z.boolean() })
    .strict(),
  z
    .object({
      action: z.enum(["open-subject", "close-subject"]),
      subjectId: groupId,
    })
    .strict(),
  z
    .object({
      action: z.enum(["assign-teacher", "remove-teacher"]),
      subjectId: groupId,
      teacherId: groupId,
    })
    .strict(),
  z
    .object({
      action: z.literal("decide"),
      status: z.enum(["ACTIVE", "REJECTED", "REMOVED"]),
      userId: groupId.optional(),
    })
    .strict(),
]);

export async function changeGroup(
  reader: ContentReader,
  id: string,
  raw: unknown,
) {
  const command = staffCommand.parse(raw);
  const days =
    command.action === "rotate-code"
      ? await getSetting("group.joinCodeDays")
      : 0;
  return getDb().$transaction(async (tx) => {
    await lockRoleAccess(tx);
    await lockGroup(tx, id);
    const { actor, group, permissions } = await groupAccess(reader, id, tx);
    const now = new Date();
    if (group.archivedAt || group.faculty.archivedAt) throw archivedError();
    if (command.action === "decide") {
      assertGroupAction(permissions, "group.members");
      return decideMembership(tx, group.id, actor.id, command, now);
    }
    if ("subjectId" in command) {
      const subject = await assertGroupSubject(
        actor,
        group,
        command.subjectId,
        tx,
      );
      const key = { groupId: id, subjectId: subject.id };
      if ("teacherId" in command) {
        return changeTeacher(tx, key, subject, actor.id, command);
      }
      if (command.action === "open-subject") {
        await tx.groupSubject.upsert({
          where: { groupId_subjectId: key },
          create: { ...key, createdById: actor.id },
          update: {},
        });
      } else {
        await tx.groupSubject.deleteMany({ where: key });
      }
      return { ok: true };
    }
    assertGroupAction(permissions, "group.manage");
    if (command.action === "rotate-code") {
      const joinCode = Array.from(
        { length: 8 },
        () => JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)],
      ).join("");
      if (joinCode === group.joinCode)
        throw new ContentError("Попробуйте сменить код ещё раз.", 409);
      await tx.studyGroup.update({
        where: { id },
        data: { joinCode, joinCodeExpiresAt: new Date(+now + days * 86400000) },
      });
    } else {
      await tx.studyGroup.update({
        where: { id },
        data:
          command.action === "archive"
            ? { archivedAt: now, joinCode: null, joinCodeExpiresAt: null }
            : { requireApproval: command.requireApproval },
      });
    }
    return { ok: true };
  });
}

async function changeTeacher(
  tx: Db,
  key: { groupId: string; subjectId: string },
  subject: { id: string; departmentId: string },
  actorId: string,
  command: { action: "assign-teacher" | "remove-teacher"; teacherId: string },
) {
  const where = { ...key, teacherId: command.teacherId };
  if (command.action === "remove-teacher") {
    await tx.groupTeacher.deleteMany({ where });
    return { ok: true };
  }
  if (!(await tx.groupSubject.count({ where: key }))) throw groupMissing();
  await assertEligibleTeacher(command.teacherId, subject, tx);
  await tx.groupTeacher.upsert({
    where: { groupId_subjectId_teacherId: where },
    create: { ...where, assignedById: actorId },
    update: {},
  });
  await tx.user.updateMany({
    where: { id: command.teacherId, role: "USER" },
    data: { role: "EDITOR", roleRevision: { increment: 1 } },
  });
  return { ok: true };
}

async function decideMembership(
  tx: Db,
  groupId: string,
  actorId: string,
  command: { status: "ACTIVE" | "REJECTED" | "REMOVED"; userId?: string },
  now: Date,
) {
  if (command.status === "REMOVED" && !command.userId)
    throw new ContentError("Выберите студента для исключения.");
  const { count } = await tx.groupMember.updateMany({
    where: {
      groupId,
      userId: command.userId,
      user: { deletedAt: null, anonymizedAt: null },
      status: command.status === "REMOVED" ? "ACTIVE" : "PENDING",
    },
    data: { status: command.status, decidedAt: now, decidedById: actorId },
  });
  if (command.userId && !count)
    throw new ContentError(
      "Участник или заявка не найдены в этом статусе.",
      404,
    );
  return { updated: count };
}

const profileFields = z
  .object({
    lastName: z.string().trim().min(1).max(100),
    firstName: z.string().trim().min(1).max(100),
    middleName: z.string().trim().max(100).default(""),
    studentNumber: z.string().trim().max(80).default(""),
    noticeVersion: z.string().min(1).max(80),
    accepted: z.literal(true),
    code: z.string().max(100),
  })
  .strict();

export async function joinGroup(
  actor: { id: string; readOnly: boolean },
  ip: string,
  raw: unknown,
) {
  if (actor.readOnly) throw denied();
  const periodStart = new Date(Math.floor(Date.now() / 60000) * 60000);
  const limit = {
    feature: "group.join",
    max: await getSetting("group.joinAttemptsPerMinute"),
    periodStart,
  };
  const limits = await Promise.allSettled([
    consumeLimit(`user:${actor.id}`, limit),
    consumeLimit(`ip:${ip}`, limit),
  ]);
  for (const result of limits)
    if (result.status === "rejected") throw result.reason;
  const {
    code: rawCode,
    noticeVersion,
    lastName,
    firstName,
    middleName,
    studentNumber,
  } = profileFields.parse(raw);
  const code = normalizeJoinCode(rawCode);
  if (!code) throw invalidCode();

  return getDb().$transaction(async (tx) => {
    await lockRoleAccess(tx);
    // Recheck the code after acquiring the same lock used by rotation and archive.
    const match = await tx.studyGroup.findUnique({
      where: { joinCode: code },
      select: { id: true },
    });
    if (!match) throw invalidCode();
    await lockGroup(tx, match.id);
    const now = new Date();
    const group = await tx.studyGroup.findFirst({
      where: {
        id: match.id,
        joinCode: code,
        joinCodeExpiresAt: { gt: now },
        archivedAt: null,
        faculty: { archivedAt: null },
      },
      select: { id: true, requireApproval: true },
    });
    if (!group) throw invalidCode();
    const userId = actor.id;
    if (
      !(await tx.user.count({
        where: { id: userId, blockedAt: null, deletedAt: null },
      }))
    )
      throw new AuthError("unauthorized", 401);
    const key = { groupId: group.id, userId };
    const existing = await tx.groupMember.findUnique({
      where: { groupId_userId: key },
    });
    if (existing?.status === "ACTIVE" || existing?.status === "PENDING")
      return { status: existing.status };
    if (
      existing?.status === "REJECTED" ||
      (existing?.status === "REMOVED" && existing.decidedById !== userId)
    )
      throw new ContentError(
        "Сотрудник уже принял решение по вашему участию в этой группе.",
        409,
      );
    const notice = await currentGroupNotice(tx);
    if (!notice || notice.version !== noticeVersion)
      throw new ContentError(
        "Уведомление обновилось. Перезагрузите страницу и прочитайте его ещё раз.",
        409,
      );
    const status = group.requireApproval ? "PENDING" : "ACTIVE";
    const membership = {
      status,
      noticeVersion,
      noticeAcceptedAt: now,
      requestedAt: now,
      decidedAt: status === "ACTIVE" ? now : null,
      decidedById: null,
    } as const;
    await tx.user.update({
      where: { id: userId },
      data: {
        lastName,
        firstName,
        middleName: middleName || null,
        studentNumber: studentNumber || null,
      },
    });
    await tx.groupMember.upsert({
      where: { groupId_userId: key },
      create: { ...key, ...membership },
      update: membership,
    });
    return { status };
  });
}

export async function leaveGroup(
  actor: { id: string; readOnly: boolean },
  id: string,
) {
  if (actor.readOnly) throw denied();
  return getDb().$transaction(async (tx) => {
    await lockRoleAccess(tx);
    await lockGroup(tx, id);
    const { count } = await tx.groupMember.updateMany({
      where: {
        groupId: id,
        userId: actor.id,
        status: { in: ["ACTIVE", "PENDING"] },
        user: { deletedAt: null, blockedAt: null },
      },
      data: { status: "REMOVED", decidedAt: new Date(), decidedById: actor.id },
    });
    if (!count) throw groupMissing();
    return { ok: true };
  });
}
