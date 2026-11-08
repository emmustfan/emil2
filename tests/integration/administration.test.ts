import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, afterAll, it, expect, vi } from "vitest";
import { getDb } from "../../lib/db";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import {
  configuration,
  savePlan,
  saveSetting,
  saveLanding,
  publishLegal,
  saveBillingText,
} from "../../lib/admin/settings";
import { grantAccess, revokeGrant } from "../../lib/admin/grants";
import { dashboard } from "../../lib/admin/reports";
import { tutorLogs } from "../../lib/admin/tutor-logs";
import { studentOverview } from "../../lib/admin/cabinet";
import {
  requestAccountDeletion,
  anonymizeAccount,
} from "../../lib/auth/deletion";
import { hasCurrentConsent, currentLegal } from "../../lib/auth/legal";
import { hasAccess } from "../../lib/access";
import {
  resumeRenewal,
  unlinkPaymentMethod,
  manualRenewal,
} from "../../lib/billing/manage";
import {
  startCheckout,
  cancelSubscription,
  dispatchPayment,
  reconcilePayment,
} from "../../lib/billing/service";
import { MockPayments } from "../../lib/payments";
import { settleMockPayment, billingTick } from "../../lib/billing/worker";
import { closeBillingQueue } from "../../lib/billing/jobs";
import { billingContent } from "../../lib/billing/config";
import { createSession, findSession } from "../../lib/auth/session";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";
vi.mock("../../lib/settings", () => ({
  getSetting: async (key: keyof typeof DEFAULT_SETTINGS) =>
    DEFAULT_SETTINGS[key],
}));
const db = getDb();
let f: LessonFixture,
  other: LessonFixture,
  admin: string,
  student: string,
  teacher: string,
  planId: string,
  code: string;
let snapshots: Awaited<ReturnType<typeof configuration>>;
const docs: string[] = [];
const users: string[] = [],
  eventIds: bigint[] = [],
  auditIds: string[] = [];
async function user(role: "ADMIN" | "USER" | "EDITOR") {
  const legal = await currentLegal(),
    u = await db.user.create({
      data: {
        email: `admin-stage-${randomUUID()}@example.test`,
        emailVerifiedAt: new Date(),
        name: "Проверка админки",
        role,
        consentPdAt: new Date(),
        consentPdVersion: legal.consent.version,
        offerVersion: legal.offer.version,
      },
    });
  users.push(u.id);
  return u.id;
}
async function purchase() {
  const legal = await currentLegal(),
    text = await billingContent(),
    u = await db.user.findUniqueOrThrow({ where: { id: student } });
  const result = await startCheckout(student, {
    requestId: randomUUID(),
    planCode: code,
    subjectId: f.subject.id,
    amountKopecks: 12300,
    periodMonths: 1,
    buyerEmail: u.email!,
    renewalConsent: true,
    renewalConsentVersion: text.version,
    offerVersion: legal.offer.version,
  });
  await settleMockPayment(result.id, "succeeded");
  return db.subscription.findFirstOrThrow({ where: { userId: student } });
}
beforeEach(async () => {
  f = await createLessonFixture("admin-stage");
  other = await createLessonFixture("admin-stage-other");
  admin = await user("ADMIN");
  student = await user("USER");
  teacher = await user("EDITOR");
  const plan = await db.plan.create({
    data: {
      code: `admin-stage-${randomUUID()}`,
      kind: "SUBJECT",
      title: "Тариф админки",
      priceKopecks: 12300,
      periodMonths: 1,
      tutorDailyLimit: 99,
    },
  });
  planId = plan.id;
  code = plan.code;
  snapshots = await configuration(admin);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const id of docs.splice(0))
    await db.legalDocument.delete({ where: { id } });
  for (const row of snapshots.settings)
    if (row.revision)
      await db.appSetting.update({
        where: { key: row.key },
        data: { value: row.value! },
      });
    else await db.appSetting.deleteMany({ where: { key: row.key } });
  for (const [key, row] of [
    ["landing.v1", snapshots.landing],
    ["billing.v1", snapshots.billing],
  ] as const) {
    if (row.revision)
      await db.landingContent.update({
        where: { key },
        data: { value: row.value },
      });
    else await db.landingContent.deleteMany({ where: { key } });
  }
  const payments = await db.payment.findMany({
      where: { planId },
      select: { id: true, providerPaymentId: true },
    }),
    paymentIds = payments.map((p) => p.id);
  await db.mockProviderRecord.deleteMany({
    where: {
      id: {
        in: payments.flatMap((p) =>
          p.providerPaymentId
            ? [p.providerPaymentId, `rule:method_${p.providerPaymentId}`]
            : [],
        ),
      },
    },
  });
  await db.paymentRefund.deleteMany({
    where: { paymentId: { in: paymentIds } },
  });
  await db.payment.deleteMany({ where: { planId } });
  await db.subscription.deleteMany({ where: { planId } });
  await db.plan.delete({ where: { id: planId } });
  await db.billingMail.deleteMany({ where: { userId: { in: users } } });
  await db.securityAudit.deleteMany({
    where: {
      OR: [
        { actorId: { in: users } },
        { targetId: { in: users } },
        { id: { in: auditIds.splice(0) } },
      ],
    },
  });
  await db.event.deleteMany({ where: { id: { in: eventIds.splice(0) } } });
  await db.teacherSubject.deleteMany({
    where: {
      OR: [{ teacherId: { in: users } }, { assignedById: { in: users } }],
    },
  });
  await cleanupLessonFixture(other);
  await cleanupLessonFixture(f, [], users.splice(0));
});
afterAll(async () => {
  await closeBillingQueue();
  await db.$disconnect();
});
it("edits a plan without repricing an existing subscription and rejects stale or unprivileged edits", async () => {
  const s = await purchase(),
    p = await db.plan.findUniqueOrThrow({ where: { id: planId } }),
    input = {
      revision: p.editRevision,
      title: p.title,
      priceKopecks: 45600,
      tutorDailyLimit: 80,
      features: ["Доступ"],
      order: 1,
      isActive: true,
    };
  await expect(savePlan(teacher, planId, input)).rejects.toMatchObject({
    status: 403,
  });
  await savePlan(admin, planId, input);
  await expect(savePlan(admin, planId, input)).rejects.toMatchObject({
    status: 409,
  });
  expect(
    (await db.subscription.findUniqueOrThrow({ where: { id: s.id } }))
      .priceKopecks,
  ).toBe(12300);
  expect(
    (await db.plan.findUniqueOrThrow({ where: { id: planId } }))
      .tutorDailyLimit,
  ).toBe(80);
});
it("validates limits and detects concurrent configuration changes", async () => {
  const row = snapshots.settings.find((r) => r.key === "lesson.passThreshold")!;
  await saveSetting(admin, {
    key: row.key,
    revision: row.revision,
    value: 0.8,
  });
  await expect(
    saveSetting(admin, { key: row.key, revision: row.revision, value: 0.9 }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await configuration(admin)).settings.find((r) => r.key === row.key)?.value,
  ).toBe(0.8);
  await expect(
    saveSetting(admin, {
      key: "billing.retryHours",
      revision: null,
      value: [72, 24],
    }),
  ).rejects.toThrow();
});
it("edits landing texts without exposing or replacing exercise answers and versions consent changes", async () => {
  const { examples, ...value } = snapshots.landing.value;
  await saveLanding(admin, {
    revision: snapshots.landing.revision,
    value: { ...value, title: "Проверяемый заголовок" },
  });
  const saved = await configuration(admin);
  expect(saved.landing.value.examples).toEqual(examples);
  expect(saved.landing.value.title).toBe("Проверяемый заголовок");
  await expect(
    saveLanding(admin, { revision: snapshots.landing.revision, value }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    saveBillingText(admin, {
      revision: snapshots.billing.revision,
      value: { ...snapshots.billing.value, renewal: "Изменённое согласие" },
    }),
  ).rejects.toThrow("новую версию");
});
it("adds legal versions without overwriting history and asks existing accounts for new consent", async () => {
  const u = await db.user.findUniqueOrThrow({ where: { id: student } }),
    old = await currentLegal();
  expect(await hasCurrentConsent(u)).toBe(true);
  const input = {
    kind: "consent",
    version: `fixture-${randomUUID()}`,
    previousId: old.consent.id,
    contentMd:
      "Только тестовый документ для проверки версий, не юридический текст.",
    confirm: true,
  };
  const d = await publishLegal(admin, input);
  docs.push(d.id);
  expect(await hasCurrentConsent(u)).toBe(false);
  expect(
    await db.legalDocument.findUnique({ where: { id: old.consent.id } }),
  ).not.toBeNull();
  await expect(
    publishLegal(admin, { ...input, version: randomUUID() }),
  ).rejects.toMatchObject({ status: 409 });
});
it("grants subject access once without subscription or charge and revokes only this grant", async () => {
  const data = {
    requestId: randomUUID(),
    subjectId: f.subject.id,
    days: 5,
    reason: "Тестовый доступ",
  };
  await expect(grantAccess(teacher, student, data)).rejects.toMatchObject({
    status: 403,
  });
  const one = await grantAccess(admin, student, data),
    again = await grantAccess(admin, student, data);
  expect(again.expiresAt).toEqual(one.expiresAt);
  expect(await hasAccess(student, f.paid)).toBe(true);
  expect(await hasAccess(student, other.paid)).toBe(false);
  expect(await db.subscription.count({ where: { userId: student } })).toBe(0);
  expect(await db.payment.count({ where: { userId: student } })).toBe(0);
  await revokeGrant(admin, student, one.id);
  expect(await hasAccess(student, f.paid)).toBe(false);
});
it("shows a learner only their own overview and uses the plan quota", async () => {
  await purchase();
  await db.topicProgress.create({
    data: {
      userId: student,
      topicId: f.free.id,
      gapsAnswered: 2,
      gapsCorrect: 1,
      completedAt: new Date(),
      testBestScore: 0.8,
    },
  });
  await db.topicProgress.create({
    data: {
      userId: teacher,
      topicId: other.free.id,
      gapsAnswered: 1,
      gapsCorrect: 1,
    },
  });
  const view = await studentOverview(student);
  expect(view.quota.limit).toBe(99);
  expect(view.subjects).toHaveLength(1);
  expect(view.subjects[0]).toMatchObject({
    completed: 1,
    total: 2,
    average: 0.8,
    permitted: true,
  });
  expect(view.recent?.topic.subjectId).toBe(f.subject.id);
});
it("limits teacher tutor logs to assigned subjects and removes account identifiers and contacts", async () => {
  await db.teacherSubject.create({
    data: { teacherId: teacher, subjectId: f.subject.id, assignedById: admin },
  });
  for (const subjectId of [f.subject.id, other.subject.id]) {
    const c = await db.tutorConversation.create({
        data: { userId: student, subjectId },
      }),
      q = await db.tutorMessage.create({
        data: {
          conversationId: c.id,
          role: "USER",
          content: "Вопрос с почтой private@example.test",
        },
      });
    await db.tutorMessage.create({
      data: {
        conversationId: c.id,
        replyToId: q.id,
        role: "ASSISTANT",
        content: "Ответ",
        feedback: -1,
        citations: [],
        tokensIn: 100,
        tokensOut: 25,
      },
    });
  }
  const logs = await tutorLogs(teacher, { inaccurate: "yes" });
  expect(logs.items).toHaveLength(1);
  expect(logs.daily[0]).toMatchObject({ input: 100, output: 25 });
  const wire = JSON.stringify(logs);
  expect(wire).not.toContain(student);
  expect(wire).not.toContain("private@example.test");
  await expect(
    tutorLogs(teacher, { subjectId: other.subject.id }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(tutorLogs(student, {})).rejects.toMatchObject({ status: 403 });
});
it("reports UTM conversions and revenue from paid dates with refunds in their own period", async () => {
  const source = `stage-${randomUUID()}`,
    now = new Date("2026-11-08T12:00:00Z");
  await db.user.update({
    where: { id: student },
    data: {
      utm: { utm_source: source },
      createdAt: new Date("2026-11-01T10:00:00Z"),
    },
  });
  const p = await db.payment.create({
    data: {
      userId: student,
      planId,
      amountKopecks: 12300,
      status: "REFUNDED",
      paidAt: new Date("2026-11-01T10:01:00Z"),
      refundedAt: new Date("2026-11-08T10:00:00Z"),
    },
  });
  void p;
  for (const [name, createdAt] of [
    ["landing_viewed", "2026-11-01T10:00:00Z"],
    ["signup_completed", "2026-11-01T10:00:00Z"],
    ["gap_answered", "2026-11-02T10:00:00Z"],
    ["test_completed", "2026-11-08T01:00:00Z"],
  ])
    await db.event.create({
      data: { userId: student, name, createdAt: new Date(createdAt) },
    });
  const r = await dashboard(
    admin,
    { from: "2026-11-01", to: "2026-11-08", source },
    new Date("2026-11-09T12:00:00Z"),
  );
  expect(r.gross).toBe(12300);
  expect(r.refunds).toBe(12300);
  expect(r.net).toBe(0);
  expect(r.funnel[0].count).toBe(1);
  expect(r.retention).toMatchObject([
    { day: 1, mature: 1, retained: 1 },
    { day: 7, mature: 1, retained: 1 },
  ]);
  const later = await dashboard(
    admin,
    { from: "2026-11-08", to: "2026-11-08", source },
    now,
  );
  expect(later.gross).toBe(0);
  expect(later.refunds).toBe(12300);
  expect(later.net).toBe(-12300);
});
it("resumes only an owned, paid subscription with fresh consent and unlinks the method", async () => {
  const s = await purchase(),
    text = await billingContent(),
    legal = await currentLegal(),
    input = {
      confirm: true,
      renewalConsent: true,
      renewalConsentVersion: text.version,
      offerVersion: legal.offer.version,
    };
  await cancelSubscription(student, s.id);
  await expect(resumeRenewal(teacher, s.id, input)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    resumeRenewal(student, s.id, { ...input, renewalConsent: false }),
  ).rejects.toThrow();
  await resumeRenewal(student, s.id, input);
  expect(
    (await db.subscription.findUniqueOrThrow({ where: { id: s.id } }))
      .autoRenew,
  ).toBe(true);
  await unlinkPaymentMethod(student, s.id);
  const current = await db.subscription.findUniqueOrThrow({
    where: { id: s.id },
  });
  expect(current.paymentMethodId).toBeNull();
  expect(current.autoRenew).toBe(false);
  expect(current.currentPeriodEnd).toEqual(s.currentPeriodEnd);
  expect(await hasAccess(student, f.paid)).toBe(true);
  await expect(resumeRenewal(student, s.id, input)).rejects.toMatchObject({
    status: 409,
  });
});
it("reuses manual retry and prevents a parallel automatic payment for the same period", async () => {
  const s = await purchase(),
    end = new Date(Date.now() - 3600000);
  await db.subscription.update({
    where: { id: s.id },
    data: {
      status: "PAST_DUE",
      currentPeriodEnd: end,
      firstFailedAt: end,
      failedAttempts: 1,
      nextRetryAt: new Date(Date.now() - 1000),
    },
  });
  const p = await manualRenewal(student, s.id),
    again = await manualRenewal(student, s.id);
  expect(again.id).toBe(p.id);
  expect(p.confirmationUrl).toContain("/dev/mock-pay/");
  await billingTick();
  expect(
    await db.payment.count({
      where: { subscriptionId: s.id, status: "PENDING" },
    }),
  ).toBe(1);
  await settleMockPayment(p.id, "succeeded");
  const current = await db.subscription.findUniqueOrThrow({
    where: { id: s.id },
  });
  expect(current.status).toBe("ACTIVE");
  expect(current.priceKopecks).toBe(12300);
  expect(current.currentPeriodEnd > end).toBe(true);
});
it("deletion revokes sessions and renewal, then anonymizes identity while preserving financial totals", async () => {
  const s = await purchase(),
    u = await db.user.findUniqueOrThrow({ where: { id: student } }),
    session = await db.$transaction((tx) => createSession(tx, student, 30, 5));
  await db.user.update({
    where: { id: student },
    data: {
      university: "Личный вуз",
      goal: "Личная цель",
      telegramId: BigInt(Date.now()),
      telegramUsername: "private-name",
    },
  });
  const e = await db.event.create({
    data: {
      name: "gap_answered",
      userId: student,
      anonId: "private-cookie",
      props: { test: "private" },
    },
  });
  eventIds.push(e.id);
  await db.loginToken.create({
    data: {
      email: u.email!,
      tokenHash: randomUUID(),
      requestNonceHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60000),
      intentUserId: student,
    },
  });
  await requestAccountDeletion(student);
  expect(await findSession(session.token)).toBeNull();
  expect(await hasAccess(student, f.paid)).toBe(false);
  expect(
    (await db.subscription.findUniqueOrThrow({ where: { id: s.id } }))
      .autoRenew,
  ).toBe(false);
  auditIds.push(
    ...(
      await db.securityAudit.findMany({
        where: { OR: [{ actorId: student }, { targetId: student }] },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  expect(await anonymizeAccount(student)).toBe(true);
  expect(await anonymizeAccount(student)).toBe(false);
  const after = await db.user.findUniqueOrThrow({ where: { id: student } });
  expect(after).toMatchObject({
    email: null,
    name: null,
    telegramId: null,
    university: null,
    goal: null,
    anonId: null,
  });
  expect(after.anonymizedAt).not.toBeNull();
  const payment = await db.payment.findFirstOrThrow({
    where: { userId: student },
  });
  expect(payment.amountKopecks).toBe(12300);
  expect(payment.status).toBe("SUCCEEDED");
  expect(payment.buyerEmail).toBeNull();
  expect(payment.raw).toBeNull();
  expect(JSON.stringify(payment.providerRequest)).not.toContain(u.email!);
  expect(await db.billingMail.count({ where: { userId: student } })).toBe(0);
  expect(await db.loginToken.count({ where: { email: u.email! } })).toBe(0);
  expect(await db.event.findUnique({ where: { id: e.id } })).toMatchObject({
    userId: null,
    props: null,
  });
});
it("does not restore a removed card when an earlier recurring payment finishes", async () => {
  const s = await purchase(),
    provider = new MockPayments();
  await provider.setRenewalOutcome(s.paymentMethodId!, "pending");
  await db.subscription.update({
    where: { id: s.id },
    data: { currentPeriodEnd: new Date(Date.now() + 3600000) },
  });
  await billingTick();
  const pending = await db.payment.findFirstOrThrow({
    where: { subscriptionId: s.id, status: "PENDING" },
  });
  await dispatchPayment(pending.id);
  await unlinkPaymentMethod(student, s.id);
  await settleMockPayment(pending.id, "succeeded");
  const sub = await db.subscription.findUniqueOrThrow({ where: { id: s.id } });
  expect(sub.paymentMethodId).toBeNull();
  expect(sub.paymentMethodTitle).toBeNull();
  expect(sub.autoRenew).toBe(false);
});
it("defers in-flight financial processing but enforces the privacy deadline and verifies a late result", async () => {
  const legal = await currentLegal(),
    text = await billingContent(),
    u = await db.user.findUniqueOrThrow({ where: { id: student } });
  const p = await startCheckout(student, {
    requestId: randomUUID(),
    planCode: code,
    subjectId: f.subject.id,
    amountKopecks: 12300,
    periodMonths: 1,
    buyerEmail: u.email!,
    renewalConsent: true,
    renewalConsentVersion: text.version,
    offerVersion: legal.offer.version,
  });
  await requestAccountDeletion(student);
  expect(await anonymizeAccount(student)).toBe(false);
  const later = new Date(Date.now() + 29 * 86400000);
  auditIds.push(
    ...(
      await db.securityAudit.findMany({
        where: { targetId: student },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  expect(await anonymizeAccount(student, later)).toBe(true);
  auditIds.push(
    ...(
      await db.securityAudit.findMany({
        where: {
          action: "ANONYMIZED_PAYMENT_REQUIRES_REVIEW",
          changes: { path: ["paymentIds"], array_contains: [p.id] },
        },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  const record = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
  await new MockPayments().settle(record.providerPaymentId!, "succeeded");
  await reconcilePayment(p.id);
  const final = await db.payment.findUniqueOrThrow({ where: { id: p.id } }),
    sub = await db.subscription.findFirstOrThrow({
      where: { userId: student },
    });
  expect(final.status).toBe("SUCCEEDED");
  expect(final.raw).toBeNull();
  expect(final.buyerEmail).toBeNull();
  expect(sub.paymentMethodId).toBeNull();
  expect(sub.autoRenew).toBe(false);
  expect(await hasAccess(student, f.paid)).toBe(false);
  eventIds.push(
    ...(
      await db.event.findMany({
        where: {
          dedupeKey: { in: [`checkout:${p.id}`, `payment-paid:${p.id}`] },
        },
      })
    ).map((e) => e.id),
  );
});
it("protects a configured owner from account deletion", async () => {
  const u = await db.user.findUniqueOrThrow({ where: { id: admin } });
  vi.stubEnv("ADMIN_EMAILS", u.email!);
  await expect(requestAccountDeletion(admin)).rejects.toMatchObject({
    status: 409,
  });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: admin } })).deletedAt,
  ).toBeNull();
});
