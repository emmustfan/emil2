import type { ImpersonationSession, Prisma } from "../generated/prisma/client";
import { getDb } from "../db";
import { getSetting } from "../settings";
import { ContentError } from "../content/errors";
import { hashToken, isToken, newToken } from "./crypto";
import { findSession, lock } from "./session";
import { lockRoleAccess } from "./role-lock";
import { hasCurrentConsent } from "./legal";
import {
  canImpersonate,
  impersonationInput,
  shouldAuditBlockedWrite,
} from "./impersonation-policy";
type Db = Prisma.TransactionClient;
type RawSession = NonNullable<Awaited<ReturnType<typeof findSession>>>;
export type CurrentSession = RawSession & {
  readOnly?: true;
  impersonation?: { id: string; adminId: string; expiresAt: Date };
};
type EndReason = "exit" | "expired" | "admin_logout" | "admin_revoked";
async function end(
  tx: Db,
  row: ImpersonationSession,
  reason: EndReason,
  now: Date,
) {
  if (row.endedAt) return;
  const endedAt = reason === "expired" ? row.expiresAt : now;
  const changed = await tx.impersonationSession.updateMany({
    where: { id: row.id, endedAt: null },
    data: { endedAt, endedReason: reason },
  });
  if (changed.count)
    await tx.securityAudit.create({
      data: {
        actorId: row.adminId,
        targetId: row.targetUserId,
        action: "IMPERSONATION_ENDED",
        createdAt: now,
        changes: {
          impersonationId: row.id,
          reason,
          durationMs: Math.max(0, +endedAt - +row.startedAt),
        },
      },
    });
}
export async function startImpersonation(
  adminId: string,
  input: unknown,
  now = new Date(),
) {
  const parsed = impersonationInput.parse(input),
    minutes = await getSetting("admin.impersonationMinutes");
  return getDb().$transaction(async (tx) => {
    await lockRoleAccess(tx);
    await lock(tx, `impersonation:${adminId}`);
    const [admin, target] = await Promise.all([
      tx.user.findUnique({ where: { id: adminId } }),
      tx.user.findUnique({ where: { id: parsed.targetUserId } }),
    ]);
    if (
      !admin ||
      !target ||
      !canImpersonate(admin, target) ||
      !(await hasCurrentConsent(admin))
    )
      throw new ContentError("Просмотр этого пользователя недоступен.", 403);
    const active = await tx.impersonationSession.findMany({
      where: { adminId, endedAt: null },
    });
    for (const row of active) {
      if (row.expiresAt > now)
        throw new ContentError(
          "Сначала завершите текущий режим просмотра.",
          409,
        );
      await end(tx, row, "expired", now);
    }
    const token = newToken(),
      expiresAt = new Date(+now + minutes * 60000);
    const session = await tx.impersonationSession.create({
      data: {
        tokenHash: hashToken(token),
        adminId,
        targetUserId: target.id,
        reason: parsed.reason,
        startedAt: now,
        expiresAt,
      },
    });
    await tx.securityAudit.create({
      data: {
        actorId: adminId,
        targetId: target.id,
        action: "IMPERSONATION_STARTED",
        createdAt: now,
        changes: {
          impersonationId: session.id,
          reason: parsed.reason,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });
    if (target.role === "USER")
      await tx.studentDataAccess.create({
        data: {
          viewerId: adminId,
          studentId: target.id,
          view: "impersonation",
          createdAt: now,
        },
      });
    return { token, session, role: target.role };
  });
}
export async function resolveCurrentSession(
  sid?: string,
  token?: string,
  renew = false,
  now = new Date(),
): Promise<CurrentSession | null> {
  const raw = await findSession(sid, !token && renew);
  if (!isToken(token)) {
    // A closed browser can drop its mode cookie. Expired modes still receive an end audit.
    if (raw?.user.role === "ADMIN")
      await expireAdminImpersonations(raw.userId, now);
    return raw;
  }
  return getDb().$transaction(async (tx) => {
    await lockRoleAccess(tx);
    const initial = await tx.impersonationSession.findUnique({
      where: { tokenHash: hashToken(token!) },
    });
    if (!initial) return raw;
    await lock(tx, `impersonation:${initial.adminId}`);
    const row = await tx.impersonationSession.findUniqueOrThrow({
      where: { id: initial.id },
    });
    if (row.endedAt) return raw;
    if (raw && raw.userId !== row.adminId) return raw;
    const [admin, target] = await Promise.all([
      tx.user.findUnique({ where: { id: row.adminId } }),
      tx.user.findUnique({ where: { id: row.targetUserId } }),
    ]);
    if (!admin || !target || !canImpersonate(admin, target)) {
      await end(tx, row, "admin_revoked", now);
      return raw;
    }
    if (row.expiresAt <= now) {
      await end(tx, row, "expired", now);
      return raw;
    }
    if (!raw) {
      await end(tx, row, "admin_logout", now);
      return null;
    }
    return {
      ...raw,
      userId: target.id,
      user: target,
      readOnly: true,
      impersonation: {
        id: row.id,
        adminId: row.adminId,
        expiresAt: row.expiresAt,
      },
    };
  });
}
async function expireAdminImpersonations(adminId: string, now: Date) {
  const expired = await getDb().impersonationSession.findFirst({
    where: { adminId, endedAt: null, expiresAt: { lte: now } },
    select: { id: true },
  });
  if (!expired) return;
  await getDb().$transaction(async (tx) => {
    await lock(tx, `impersonation:${adminId}`);
    const rows = await tx.impersonationSession.findMany({
      where: { adminId, endedAt: null, expiresAt: { lte: now } },
    });
    for (const row of rows) await end(tx, row, "expired", now);
  });
}
export async function stopImpersonation(
  adminId: string,
  token?: string,
  now = new Date(),
) {
  if (!isToken(token)) return null;
  return getDb().$transaction(async (tx) => {
    await lock(tx, `impersonation:${adminId}`);
    const row = await tx.impersonationSession.findFirst({
      where: { adminId, tokenHash: hashToken(token!) },
    });
    if (!row) return null;
    await end(tx, row, row.expiresAt <= now ? "expired" : "exit", now);
    return row.targetUserId;
  });
}
export async function endAdminImpersonations(
  adminId: string,
  now = new Date(),
) {
  return getDb().$transaction(async (tx) => {
    await lock(tx, `impersonation:${adminId}`);
    const rows = await tx.impersonationSession.findMany({
      where: { adminId, endedAt: null },
    });
    for (const row of rows)
      await end(
        tx,
        row,
        row.expiresAt <= now ? "expired" : "admin_logout",
        now,
      );
  });
}
export async function auditImpersonationWrite(
  session: CurrentSession,
  method: string,
  path: string,
  now = new Date(),
) {
  const mode = session.impersonation;
  if (!mode) return;
  await getDb().$transaction(async (tx) => {
    await lock(tx, `impersonation-write:${mode.id}:${path}`);
    const last = await tx.securityAudit.findFirst({
      where: {
        actorId: mode.adminId,
        targetId: session.userId,
        action: "IMPERSONATION_WRITE_BLOCKED",
        AND: [
          { changes: { path: ["impersonationId"], equals: mode.id } },
          { changes: { path: ["path"], equals: path } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (shouldAuditBlockedWrite(last?.createdAt ?? null, now))
      await tx.securityAudit.create({
        data: {
          actorId: mode.adminId,
          targetId: session.userId,
          action: "IMPERSONATION_WRITE_BLOCKED",
          createdAt: now,
          changes: { impersonationId: mode.id, method, path },
        },
      });
  });
}
