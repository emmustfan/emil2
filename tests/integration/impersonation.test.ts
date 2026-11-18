import { beforeEach, afterEach, afterAll, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { getDb } from "../../lib/db";
import { getEnv } from "../../lib/env";
import { withSettingsSnapshot } from "../../lib/settings";
import {
  createImpersonationFixture,
  snapshotImpersonationData,
  type ImpersonationFixture,
} from "../helpers/impersonation-fixture";
import {
  startImpersonation,
  resolveCurrentSession,
  stopImpersonation,
  auditImpersonationWrite,
} from "../../lib/auth/impersonation";
import { getCurrentSession } from "../../lib/auth/server";
import { lessonActor } from "../../lib/lessons/actor";
import { loadLesson, answerGap } from "../../lib/lessons/service";
import { getTutorQuota } from "../../lib/tutor/quota";
import { studentOverview } from "../../lib/admin/cabinet";
import { hasAccess } from "../../lib/access";
import { POST as logout } from "../../app/api/auth/logout/route";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { value: jar.get(name) } : undefined,
  }),
}));
const db = getDb();
let f: ImpersonationFixture;
beforeEach(async () => {
  f = await createImpersonationFixture();
  jar.clear();
});
afterEach(async () => {
  jar.clear();
  await f.cleanup();
});
afterAll(async () => {
  await db.$disconnect();
});
function test(name: string, action: () => Promise<void>) {
  it(name, () => withSettingsSnapshot(action));
}
const reason = "Проверка обращения пользователя";
async function start() {
  return startImpersonation(f.admin.id, { targetUserId: f.student.id, reason });
}
test("starts only for verified administrators, rejects forbidden targets/reasons and records the token hash and both audits", async () => {
  for (const id of [f.student.id, f.teacher.id])
    await expect(
      startImpersonation(id, { targetUserId: f.student.id, reason }),
    ).rejects.toMatchObject({ status: 403 });
  for (const id of [f.admin.id, "missing-user"])
    await expect(
      startImpersonation(f.admin.id, { targetUserId: id, reason }),
    ).rejects.toMatchObject({ status: 403 });
  await db.user.update({
    where: { id: f.teacher.id },
    data: { role: "ADMIN" },
  });
  await expect(
    startImpersonation(f.admin.id, { targetUserId: f.teacher.id, reason }),
  ).rejects.toMatchObject({ status: 403 });
  await db.user.update({
    where: { id: f.teacher.id },
    data: { role: "EDITOR" },
  });
  await expect(
    startImpersonation(f.admin.id, { targetUserId: f.student.id }),
  ).rejects.toMatchObject({ name: "ZodError" });
  await db.user.update({
    where: { id: f.student.id },
    data: { deletedAt: new Date() },
  });
  await expect(start()).rejects.toMatchObject({ status: 403 });
  await db.user.update({
    where: { id: f.student.id },
    data: { deletedAt: null, anonymizedAt: new Date() },
  });
  await expect(start()).rejects.toMatchObject({ status: 403 });
  await db.user.update({
    where: { id: f.student.id },
    data: { anonymizedAt: null },
  });
  await db.user.update({
    where: { id: f.admin.id },
    data: { emailVerifiedAt: null },
  });
  await expect(start()).rejects.toMatchObject({ status: 403 });
  await db.user.update({
    where: { id: f.admin.id },
    data: { emailVerifiedAt: new Date() },
  });
  const mode = await start();
  expect(mode.session.tokenHash).not.toBe(mode.token);
  expect(+mode.session.expiresAt - +mode.session.startedAt).toBe(30 * 60000);
  expect(
    await db.securityAudit.count({
      where: { actorId: f.admin.id, action: "IMPERSONATION_STARTED" },
    }),
  ).toBe(1);
  expect(
    await db.studentDataAccess.findFirst({
      where: { studentId: f.student.id },
    }),
  ).toMatchObject({
    viewerId: f.admin.id,
    view: "impersonation",
    subjectId: null,
  });
  const audit = await db.securityAudit.findFirstOrThrow({
    where: { actorId: f.admin.id },
  });
  expect(JSON.stringify(audit)).not.toContain(mode.token);
  expect(await resolveCurrentSession(undefined, mode.token)).toBeNull();
});
test("allows exactly one active mode even when two starts race", async () => {
  const result = await Promise.allSettled([start(), start()]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(result.find((r) => r.status === "rejected")).toMatchObject({
    reason: { status: 409 },
  });
  expect(
    await db.impersonationSession.count({
      where: { adminId: f.admin.id, endedAt: null },
    }),
  ).toBe(1);
});
test("returns the target and readOnly actor, preserves target sessions and all learning data, and suppresses expired tutor recovery", async () => {
  const mode = await start();
  jar.set("sid", f.adminSid);
  jar.set("impersonation", mode.token);
  const before = await snapshotImpersonationData();
  const session = await getCurrentSession();
  expect(session).toMatchObject({
    userId: f.student.id,
    user: { id: f.student.id, role: "USER" },
    readOnly: true,
    impersonation: { id: mode.session.id, adminId: f.admin.id },
  });
  const actor = await lessonActor();
  expect(actor).toEqual({ userId: f.student.id, readOnly: true });
  const lesson = await loadLesson(f.f.free.id, actor);
  expect(lesson.gaps.every((g) => g.feedback === null)).toBe(true);
  expect(JSON.stringify(lesson)).not.toMatch(
    /correctOptionIds|ОБЪЯСНЕНИЕ_ПОСЛЕ_ОТВЕТА/,
  );
  expect(await hasAccess(session!.userId, f.f.paid)).toBe(
    await hasAccess(f.student.id, f.f.paid),
  );
  expect(
    await studentOverview(session!.userId, undefined, session!.readOnly),
  ).toEqual(await studentOverview(f.student.id, undefined, true));
  await getTutorQuota(actor);
  await expect(
    answerGap(lesson.gaps[0].id, lesson.gaps[0].options[0].id, 1, actor),
  ).rejects.toMatchObject({ status: 403 });
  expect(await snapshotImpersonationData()).toEqual(before);
  expect(jar.get("sid")).toBe(f.adminSid);
  await getTutorQuota({ userId: f.student.id });
  expect(
    await db.tutorMessage.findUnique({ where: { id: f.expiredMessage.id } }),
  ).toMatchObject({ status: "FAILED" });
});
test("expires at the configured deadline, audits once and restores the real administrator", async () => {
  const mode = await start();
  const restored = await resolveCurrentSession(
    f.adminSid,
    mode.token,
    false,
    mode.session.expiresAt,
  );
  expect(restored).toMatchObject({
    userId: f.admin.id,
    user: { role: "ADMIN" },
  });
  expect(restored?.impersonation).toBeUndefined();
  await resolveCurrentSession(
    f.adminSid,
    mode.token,
    false,
    new Date(+mode.session.expiresAt + 1),
  );
  expect(
    await db.impersonationSession.findUnique({
      where: { id: mode.session.id },
    }),
  ).toMatchObject({ endedAt: mode.session.expiresAt, endedReason: "expired" });
  expect(
    await db.securityAudit.count({
      where: { actorId: f.admin.id, action: "IMPERSONATION_ENDED" },
    }),
  ).toBe(1);
  const old = await startImpersonation(
    f.admin.id,
    { targetUserId: f.student.id, reason },
    new Date(Date.now() - 31 * 60000),
  );
  expect((await resolveCurrentSession(f.adminSid))?.userId).toBe(f.admin.id);
  expect(
    await db.impersonationSession.findUnique({ where: { id: old.session.id } }),
  ).toMatchObject({ endedReason: "expired", endedAt: old.session.expiresAt });
});
test("stops idempotently, keeps all original sessions and permits a new mode", async () => {
  const mode = await start(),
    before = await db.session.findMany({
      where: { userId: { in: [f.admin.id, f.student.id] } },
      orderBy: { id: "asc" },
    });
  expect(await stopImpersonation(f.admin.id, mode.token)).toBe(f.student.id);
  await stopImpersonation(f.admin.id, mode.token);
  expect((await resolveCurrentSession(f.adminSid, mode.token))?.userId).toBe(
    f.admin.id,
  );
  expect(
    await db.session.findMany({
      where: { userId: { in: [f.admin.id, f.student.id] } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(before);
  expect(
    await db.securityAudit.count({
      where: { actorId: f.admin.id, action: "IMPERSONATION_ENDED" },
    }),
  ).toBe(1);
  expect((await start()).session.id).not.toBe(mode.session.id);
});
test("administrator logout ends viewing with admin_logout and leaves target sessions untouched", async () => {
  const mode = await start(),
    before = await db.session.findMany({ where: { userId: f.student.id } }),
    origin = new URL(getEnv().APP_URL).origin;
  const response = await logout(
    new NextRequest(`${origin}/api/auth/logout`, {
      method: "POST",
      headers: {
        origin,
        cookie: `sid=${f.adminSid}`,
        "content-type": "application/json",
      },
      body: "{}",
    }),
  );
  expect(response.status).toBe(303);
  expect(
    await db.impersonationSession.findUnique({
      where: { id: mode.session.id },
    }),
  ).toMatchObject({ endedReason: "admin_logout" });
  expect(await resolveCurrentSession(f.adminSid, mode.token)).toBeNull();
  expect(
    await db.session.findMany({ where: { userId: f.student.id } }),
  ).toEqual(before);
});
for (const change of [{ role: "EDITOR" as const }, { blockedAt: new Date() }])
  test(`revokes the mode on the next request after administrator change ${Object.keys(change)[0]}`, async () => {
    const mode = await start();
    await db.user.update({ where: { id: f.admin.id }, data: change });
    expect(
      (await resolveCurrentSession(f.adminSid, mode.token))?.impersonation,
    ).toBeUndefined();
    expect(
      await db.impersonationSession.findUnique({
        where: { id: mode.session.id },
      }),
    ).toMatchObject({ endedReason: "admin_revoked" });
    expect(
      await db.securityAudit.count({
        where: { actorId: f.admin.id, action: "IMPERSONATION_ENDED" },
      }),
    ).toBe(1);
  });
test("views blocked targets but rejects cookie substitution with a different user's session", async () => {
  await db.user.update({
    where: { id: f.student.id },
    data: { blockedAt: new Date() },
  });
  const mode = await start();
  expect(await resolveCurrentSession(f.adminSid, mode.token)).toMatchObject({
    userId: f.student.id,
    readOnly: true,
  });
  const other = await resolveCurrentSession(f.teacherSid, mode.token);
  expect(other?.userId).toBe(f.teacher.id);
  expect(other?.impersonation).toBeUndefined();
  expect(
    (await loadLesson(f.f.free.id, { userId: f.student.id, readOnly: true }))
      .locked,
  ).toBe(false);
});
test("throttles write-block audits atomically by path and minute without storing bodies or cookies", async () => {
  const mode = await start(),
    session = (await resolveCurrentSession(f.adminSid, mode.token))!,
    now = new Date();
  await Promise.all(
    Array.from({ length: 8 }, () =>
      auditImpersonationWrite(session, "POST", "/api/profile", now),
    ),
  );
  await auditImpersonationWrite(
    session,
    "PATCH",
    "/api/profile",
    new Date(+now + 59999),
  );
  expect(
    await db.securityAudit.count({
      where: { actorId: f.admin.id, action: "IMPERSONATION_WRITE_BLOCKED" },
    }),
  ).toBe(1);
  await auditImpersonationWrite(
    session,
    "POST",
    "/api/profile",
    new Date(+now + 60000),
  );
  const rows = await db.securityAudit.findMany({
    where: { actorId: f.admin.id, action: "IMPERSONATION_WRITE_BLOCKED" },
  });
  expect(rows).toHaveLength(2);
  expect(rows[0].changes).toEqual({
    impersonationId: mode.session.id,
    method: "POST",
    path: "/api/profile",
  });
});
