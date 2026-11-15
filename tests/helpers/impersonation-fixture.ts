import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db";
import { currentLegal } from "../../lib/auth/legal";
import { newToken, hashToken } from "../../lib/auth/crypto";
import { createLessonFixture, cleanupLessonFixture } from "./lesson-fixture";
export async function createImpersonationFixture() {
  const db = getDb(),
    f = await createLessonFixture("impersonation"),
    legal = await currentLegal(),
    ids: string[] = [];
  async function user(role: "ADMIN" | "EDITOR" | "USER", name: string) {
    const u = await db.user.create({
      data: {
        role,
        name,
        email: `impersonation-${randomUUID()}@example.test`,
        emailVerifiedAt: new Date(),
        consentPdAt: new Date(),
        consentPdVersion: legal.consent.version,
        offerVersion: legal.offer.version,
        university: "Учебный стенд",
        course: 1,
      },
    });
    ids.push(u.id);
    return u;
  }
  const admin = await user("ADMIN", "Администратор просмотра"),
    student = await user("USER", "Демо ученик просмотра (демо)"),
    teacher = await user("EDITOR", "Учитель просмотра");
  await db.teacherSubject.create({
    data: {
      teacherId: teacher.id,
      subjectId: f.subject.id,
      assignedById: admin.id,
    },
  });
  await db.accessGrant.create({
    data: {
      userId: student.id,
      subjectId: f.subject.id,
      grantedById: admin.id,
      reason: "Проверка режима просмотра",
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  async function session(userId: string, stale = false) {
    const token = newToken();
    await db.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 86400000),
        lastSeenAt: new Date(Date.now() - (stale ? 86400000 : 0)),
      },
    });
    return token;
  }
  const adminSid = await session(admin.id),
    studentSid = await session(student.id, true),
    teacherSid = await session(teacher.id, true);
  const plan = await db.plan.create({
    data: {
      code: `impersonation-${randomUUID()}`,
      kind: "SUBJECT",
      title: "Тариф проверки",
      priceKopecks: 1000,
      tutorDailyLimit: 10,
      features: [],
    },
  });
  const payment = await db.payment.create({
    data: {
      userId: student.id,
      planId: plan.id,
      subjectId: f.subject.id,
      amountKopecks: 1000,
      planTitle: plan.title,
      buyerEmail: student.email,
      status: "PENDING",
    },
  });
  const conversation = await db.tutorConversation.create({
    data: { userId: student.id, subjectId: f.subject.id, topicId: f.free.id },
  });
  const expiredMessage = await db.tutorMessage.create({
    data: {
      conversationId: conversation.id,
      role: "USER",
      content: "Синтетический вопрос с истёкшей обработкой",
      status: "RUNNING",
      runToken: newToken(),
      leaseUntil: new Date(Date.now() - 60000),
      quotaPeriodStart: new Date(0),
    },
  });
  await db.usageCounter.create({
    data: {
      actorKey: `user:${student.id}`,
      feature: "tutor",
      periodStart: new Date(0),
      count: 1,
    },
  });
  return {
    f,
    admin,
    student,
    teacher,
    adminSid,
    studentSid,
    teacherSid,
    payment,
    expiredMessage,
    async cleanup() {
      await db.impersonationSession.deleteMany({
        where: {
          OR: [{ adminId: { in: ids } }, { targetUserId: { in: ids } }],
        },
      });
      await db.payment.deleteMany({ where: { userId: { in: ids } } });
      await cleanupLessonFixture(f, [], ids);
      await db.plan.delete({ where: { id: plan.id } });
    },
  };
}
export type ImpersonationFixture = Awaited<
  ReturnType<typeof createImpersonationFixture>
>;
export const protectedImpersonationTables = [
  "User",
  "Session",
  "TopicProgress",
  "GapAnswer",
  "GapAttempt",
  "Card",
  "ReviewLog",
  "TestRun",
  "QuestionAttempt",
  "UsageCounter",
  "Event",
  "TutorConversation",
  "TutorMessage",
  "Payment",
  "Subscription",
  "Topic",
  "Question",
  "Gap",
  "TopicRevision",
  "TeacherSubject",
] as const;
export async function snapshotImpersonationData() {
  const result: Record<string, { count: number; digest: string }> = {};
  for (const table of protectedImpersonationTables) {
    const rows = await getDb().$queryRawUnsafe<
      { count: number; digest: string }[]
    >(
      `SELECT count(*)::int AS count, md5(COALESCE(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text), '')) AS digest FROM "${table}" t`,
    );
    result[table] = rows[0];
  }
  return result;
}
