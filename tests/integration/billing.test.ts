import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getDb } from "../../lib/db";
import { currentLegal } from "../../lib/auth/legal";
import {
  startCheckout,
  reconcilePayment,
  dispatchPayment,
  paymentStatus,
  cancelSubscription,
} from "../../lib/billing/service";
import { requestRefund, dispatchRefund } from "../../lib/billing/refunds";
import { billingTick, settleMockPayment } from "../../lib/billing/worker";
import { closeBillingQueue } from "../../lib/billing/jobs";
import { deliverBillingMail } from "../../lib/billing/mail";
import {
  createPaymentsProvider,
  MockPayments,
  DatabaseMockStore,
} from "../../lib/payments";
import { getEnv } from "../../lib/env";
import { hasAccess } from "../../lib/access";
import { allowsAccess } from "../../lib/access/policy";
import { DEFAULT_SETTINGS } from "../../lib/settings/defaults";
import { LogMailTransport } from "../../lib/mail";
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
let f: LessonFixture;
const users: string[] = [],
  plans: string[] = [],
  mockIds: string[] = [];
let admin: string;
async function buyer(role: "ADMIN" | "EDITOR" | "USER" = "USER") {
  const docs = await currentLegal(),
    u = await db.user.create({
      data: {
        name: "Покупатель теста",
        email: `billing-${randomUUID()}@example.test`,
        emailVerifiedAt: new Date(),
        role,
        consentPdAt: new Date(),
        consentPdVersion: docs.consent.version,
        offerVersion: docs.offer.version,
        timezone: "Asia/Yekaterinburg",
      },
    });
  users.push(u.id);
  return u;
}
async function plan() {
  const p = await db.plan.create({
    data: {
      code: `billing-${randomUUID()}`,
      kind: "SUBJECT",
      title: "Тестовый предмет",
      priceKopecks: 12300,
      periodMonths: 1,
      tutorDailyLimit: 150,
      features: [],
    },
  });
  plans.push(p.id);
  return p;
}
async function setup() {
  const u = await buyer(),
    p = await plan(),
    docs = await currentLegal();
  return {
    u,
    p,
    input: {
      requestId: randomUUID(),
      planCode: p.code,
      subjectId: f.subject.id,
      amountKopecks: p.priceKopecks,
      periodMonths: p.periodMonths,
      buyerEmail: u.email!,
      renewalConsent: true as const,
      renewalConsentVersion: "1",
      offerVersion: docs.offer.version,
    },
  };
}
async function paid() {
  const x = await setup(),
    payment = await startCheckout(x.u.id, x.input);
  await settleMockPayment(payment.id, "succeeded", x.u.id);
  return {
    ...x,
    payment,
    sub: await db.subscription.findFirstOrThrow({ where: { userId: x.u.id } }),
  };
}
async function cleanup() {
  const paymentRows = await db.payment.findMany({
      where: { userId: { in: users } },
      select: { id: true, providerPaymentId: true },
    }),
    ids = paymentRows.map((p) => p.id);
  const refunds = await db.paymentRefund.findMany({
    where: { paymentId: { in: ids } },
    select: { id: true, providerRefundId: true },
  });
  const providerIds = paymentRows
    .flatMap((p) =>
      p.providerPaymentId
        ? [p.providerPaymentId, `rule:method_${p.providerPaymentId}`]
        : [],
    )
    .concat(
      refunds.flatMap((r) => (r.providerRefundId ? [r.providerRefundId] : [])),
      mockIds.splice(0),
    );
  await db.mockProviderRecord.deleteMany({
    where: { id: { in: providerIds } },
  });
  await db.paymentRefund.deleteMany({ where: { paymentId: { in: ids } } });
  await db.billingMail.deleteMany({ where: { userId: { in: users } } });
  await db.payment.deleteMany({ where: { id: { in: ids } } });
  await db.subscription.deleteMany({ where: { userId: { in: users } } });
  await db.event.deleteMany({ where: { userId: { in: users } } });
  for (const id of users)
    await db.usageCounter.deleteMany({ where: { actorKey: `user:${id}` } });
  await db.session.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users.splice(0) } } });
  await db.plan.deleteMany({ where: { id: { in: plans.splice(0) } } });
}
beforeAll(async () => {
  f = await createLessonFixture("billing-integration");
  const a = await buyer("ADMIN");
  admin = a.id;
});
afterEach(async () => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await closeBillingQueue();
  await cleanup();
  if (f) await cleanupLessonFixture(f);
  await db.$disconnect();
});
describe("billing with PostgreSQL and durable mock provider", () => {
  it("rejects omitted consent, stale prices and invalid subjects before creating payment", async () => {
    const x = await setup();
    await expect(
      startCheckout(x.u.id, { ...x.input, renewalConsent: false }),
    ).rejects.toThrow();
    await expect(
      startCheckout(x.u.id, { ...x.input, amountKopecks: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      startCheckout(x.u.id, { ...x.input, subjectId: "foreign" }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await db.payment.count({ where: { userId: x.u.id } })).toBe(0);
  });
  it("serializes concurrent checkout requests into one immutable payment and one event", async () => {
    const x = await setup();
    const [a, b] = await Promise.all([
      startCheckout(x.u.id, x.input),
      startCheckout(x.u.id, x.input),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.status).toBe("PENDING");
    expect(await db.payment.count({ where: { userId: x.u.id } })).toBe(1);
    expect(
      await db.event.count({
        where: { userId: x.u.id, name: "checkout_started" },
      }),
    ).toBe(1);
    const provider = new MockPayments();
    expect((await provider.getPayment(`mock_${a.id}`)).amount.value).toBe(
      "123.00",
    );
    await expect(paymentStatus(admin, a.id, false)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      startCheckout(x.u.id, { ...x.input, amountKopecks: 555 }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("opens only the purchased subject, emits once and ignores repeated success", async () => {
    const x = await paid();
    expect(
      await hasAccess(x.u.id, { subjectId: f.subject.id, isFree: false }),
    ).toBe(true);
    expect(
      await hasAccess(x.u.id, { subjectId: "other-subject", isFree: false }),
    ).toBe(false);
    const end = x.sub.currentPeriodEnd;
    await Promise.all([
      reconcilePayment(x.payment.id),
      reconcilePayment(x.payment.id),
    ]);
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { id: x.sub.id } }))
        .currentPeriodEnd,
    ).toEqual(end);
    expect(
      await db.event.count({
        where: { userId: x.u.id, name: "payment_succeeded" },
      }),
    ).toBe(1);
    const dto = JSON.stringify(await paymentStatus(x.u.id, x.payment.id));
    expect(dto).not.toMatch(
      /paymentMethodId|providerPaymentId|raw|metadata|buyerEmail/,
    );
  });
  it("pins the first charged price and renewal price despite edits to Plan", async () => {
    const x = await setup(),
      p = await startCheckout(x.u.id, x.input);
    await db.plan.update({
      where: { id: x.p.id },
      data: { priceKopecks: 99900 },
    });
    await settleMockPayment(p.id, "succeeded", x.u.id);
    const sub = await db.subscription.findFirstOrThrow({
      where: { userId: x.u.id },
    });
    expect(sub.priceKopecks).toBe(12300);
    const now = new Date(sub.currentPeriodEnd.getTime() - 86400000);
    await Promise.all([billingTick(now), billingTick(now)]);
    const renewal = await db.payment.findFirstOrThrow({
      where: { subscriptionId: sub.id, isRecurring: true },
    });
    expect(renewal.amountKopecks).toBe(12300);
    await dispatchPayment(renewal.id, now);
    const next = await db.subscription.findUniqueOrThrow({
      where: { id: sub.id },
      include: { plan: true },
    });
    expect(next.currentPeriodEnd.getTime()).toBeGreaterThan(
      sub.currentPeriodEnd.getTime(),
    );
    expect(next.currentPeriodStart).toEqual(sub.currentPeriodStart);
    expect(
      allowsAccess(
        { subjectId: f.subject.id, isFree: false },
        { subscriptions: [next], grants: [] },
        new Date(),
        3,
      ),
    ).toBe(true);
    expect(
      await db.payment.count({
        where: { subscriptionId: sub.id, isRecurring: true },
      }),
    ).toBe(1);
  });
  it("cancels in two steps without removing the paid period and expires at its end", async () => {
    const x = await paid();
    await cancelSubscription(x.u.id, x.sub.id);
    await cancelSubscription(x.u.id, x.sub.id);
    let sub = await db.subscription.findUniqueOrThrow({
      where: { id: x.sub.id },
    });
    expect(sub.autoRenew).toBe(false);
    expect(sub.currentPeriodEnd).toEqual(x.sub.currentPeriodEnd);
    expect(
      await hasAccess(x.u.id, { subjectId: f.subject.id, isFree: false }),
    ).toBe(true);
    await billingTick(new Date(x.sub.currentPeriodEnd.getTime() + 1));
    sub = await db.subscription.findUniqueOrThrow({ where: { id: x.sub.id } });
    expect(sub.status).toBe("EXPIRED");
    expect(
      await db.payment.count({
        where: { subscriptionId: x.sub.id, isRecurring: true },
      }),
    ).toBe(0);
    expect(
      await db.event.count({
        where: { userId: x.u.id, name: "subscription_canceled" },
      }),
    ).toBe(1);
  });
  it("keeps grace access after two failures and expires after the third, retrying at 24 and 72 hours", async () => {
    const x = await paid(),
      mock = createPaymentsProvider(getEnv()) as MockPayments;
    await mock.setRenewalOutcome(x.sub.paymentMethodId!, "canceled");
    mockIds.push(`rule:${x.sub.paymentMethodId}`);
    const first = new Date(x.sub.currentPeriodEnd.getTime() - 86400000);
    for (const [index, hours] of [0, 24, 72].entries()) {
      const now = new Date(first.getTime() + hours * 3600000);
      await billingTick(now);
      const p = await db.payment.findFirstOrThrow({
        where: { subscriptionId: x.sub.id, isRecurring: true, attempt: index },
      });
      await dispatchPayment(p.id, now);
      await reconcilePayment(p.id, now);
      const sub = await db.subscription.findUniqueOrThrow({
        where: { id: x.sub.id },
        include: { plan: true },
      });
      expect(sub.failedAttempts).toBe(index + 1);
      if (index < 2) {
        expect(sub.status).toBe("PAST_DUE");
        expect(sub.nextRetryAt).toEqual(
          new Date(first.getTime() + (index === 0 ? 24 : 72) * 3600000),
        );
        expect(
          allowsAccess(
            { subjectId: f.subject.id, isFree: false },
            { subscriptions: [sub], grants: [] },
            new Date(x.sub.currentPeriodEnd.getTime() + 1000),
            3,
          ),
        ).toBe(true);
      } else {
        expect(sub.status).toBe("EXPIRED");
        expect(sub.autoRenew).toBe(false);
      }
    }
  });
  it("refunds once, closes access and rejects teachers and students", async () => {
    const x = await paid(),
      teacher = await buyer("EDITOR");
    await expect(requestRefund(teacher.id, x.payment.id)).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(requestRefund(x.u.id, x.payment.id)).rejects.toMatchObject({
      status: 403,
    });
    const [a, b] = await Promise.all([
      requestRefund(admin, x.payment.id),
      requestRefund(admin, x.payment.id),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.status).toBe("SUCCEEDED");
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: x.payment.id } }))
        .status,
    ).toBe("REFUNDED");
    expect(
      await hasAccess(x.u.id, { subjectId: f.subject.id, isFree: false }),
    ).toBe(false);
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { id: x.sub.id } }))
        .revokedAt,
    ).not.toBeNull();
  });
  it("never accepts a forged provider amount or metadata", async () => {
    const x = await setup(),
      p = await startCheckout(x.u.id, x.input),
      store = new DatabaseMockStore();
    const row = (await store.get(`mock_${p.id}`)) as {
      fingerprint: string;
      payment: Record<string, unknown>;
    };
    await store.replace(`mock_${p.id}`, {
      ...row,
      payment: {
        ...row.payment,
        status: "succeeded",
        paid: true,
        amount: { value: "0.01", currency: "RUB" },
      },
    });
    await expect(reconcilePayment(p.id)).rejects.toMatchObject({ status: 409 });
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status,
    ).toBe("PENDING");
    expect(await db.subscription.count({ where: { userId: x.u.id } })).toBe(0);
  });
  it("delivers an outbox message once after commit and keeps recipient data out of events", async () => {
    const x = await paid(),
      mail = await db.billingMail.findFirstOrThrow({
        where: { userId: x.u.id, kind: "paid" },
      }),
      send = vi
        .spyOn(LogMailTransport.prototype, "send")
        .mockResolvedValue(randomUUID());
    await deliverBillingMail(mail.key);
    await deliverBillingMail(mail.key);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].html).toContain("<html");
    expect(
      (await db.billingMail.findUniqueOrThrow({ where: { key: mail.key } }))
        .sentAt,
    ).not.toBeNull();
    const events = await db.event.findMany({ where: { userId: x.u.id } });
    expect(JSON.stringify(events.map((e) => e.props))).not.toContain(
      x.u.email!,
    );
  });
  it("a late pending renewal after refund is refunded without reopening access", async () => {
    const x = await paid(),
      mock = createPaymentsProvider(getEnv()) as MockPayments;
    await mock.setRenewalOutcome(x.sub.paymentMethodId!, "pending");
    mockIds.push(`rule:${x.sub.paymentMethodId}`);
    const now = new Date(x.sub.currentPeriodEnd.getTime() - 86400000);
    await billingTick(now);
    const renewal = await db.payment.findFirstOrThrow({
      where: { subscriptionId: x.sub.id, isRecurring: true },
    });
    await dispatchPayment(renewal.id, now);
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: renewal.id } }))
        .status,
    ).toBe("PENDING");
    await requestRefund(admin, x.payment.id);
    await settleMockPayment(renewal.id, "succeeded", x.u.id);
    const refund = await db.paymentRefund.findUniqueOrThrow({
      where: { paymentId: renewal.id },
    });
    await dispatchRefund(refund.id);
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: renewal.id } }))
        .status,
    ).toBe("REFUNDED");
    expect(
      await hasAccess(x.u.id, { subjectId: f.subject.id, isFree: false }),
    ).toBe(false);
  });
  it("refuses overlapping all-subject billing until the existing paid subject period ends", async () => {
    const x = await paid();
    const all = await db.plan.create({
      data: {
        code: `billing-all-${randomUUID()}`,
        kind: "ALL_SUBJECTS",
        title: "Все предметы теста",
        priceKopecks: 30000,
        periodMonths: 1,
        tutorDailyLimit: 150,
        features: [],
      },
    });
    plans.push(all.id);
    await expect(
      startCheckout(x.u.id, {
        ...x.input,
        requestId: randomUUID(),
        planCode: all.code,
        subjectId: undefined,
        amountKopecks: all.priceKopecks,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.payment.count({ where: { userId: x.u.id } })).toBe(1);
  });
  it("queues one renewal reminder before the planned debit", async () => {
    const x = await paid(),
      when = new Date(x.sub.currentPeriodEnd.getTime() - 4 * 86400000);
    await billingTick(when);
    await billingTick(when);
    const messages = await db.billingMail.findMany({
      where: { userId: x.u.id, kind: "reminder" },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toContain("123");
    expect(messages[0].text).toContain("/cabinet/subscription");
    expect(
      await db.payment.count({
        where: { subscriptionId: x.sub.id, isRecurring: true },
      }),
    ).toBe(0);
  });
  it("cancels an unstarted queued renewal without asking the provider to charge", async () => {
    const x = await paid(),
      when = new Date(x.sub.currentPeriodEnd.getTime() - 86400000);
    await billingTick(when);
    const p = await db.payment.findFirstOrThrow({
      where: { subscriptionId: x.sub.id, isRecurring: true },
    });
    await cancelSubscription(x.u.id, x.sub.id);
    await dispatchPayment(p.id, when);
    expect(
      await db.payment.findUniqueOrThrow({ where: { id: p.id } }),
    ).toMatchObject({ status: "CANCELED", providerPaymentId: null });
    expect(
      await db.mockProviderRecord.findUnique({ where: { id: `mock_${p.id}` } }),
    ).toBeNull();
  });
  it("refunds a stale extra renewal while retaining a separately paid newer period and card", async () => {
    const x = await paid(),
      mock = createPaymentsProvider(getEnv()) as MockPayments;
    await mock.setRenewalOutcome(x.sub.paymentMethodId!, "pending");
    mockIds.push(`rule:${x.sub.paymentMethodId}`);
    const due = new Date(x.sub.currentPeriodEnd.getTime() - 86400000);
    await billingTick(due);
    const old = await db.payment.findFirstOrThrow({
      where: { subscriptionId: x.sub.id, isRecurring: true },
    });
    await dispatchPayment(old.id, due);
    await cancelSubscription(x.u.id, x.sub.id);
    const later = new Date(x.sub.currentPeriodEnd.getTime() + 3600000);
    const next = await startCheckout(
      x.u.id,
      { ...x.input, requestId: randomUUID() },
      later,
    );
    const nextRow = await db.payment.findUniqueOrThrow({
      where: { id: next.id },
    });
    await mock.settle(nextRow.providerPaymentId!, "succeeded");
    await reconcilePayment(next.id, later);
    const before = await db.subscription.findUniqueOrThrow({
      where: { id: x.sub.id },
      include: { plan: true },
    });
    await mock.settle(old.providerPaymentId ?? `mock_${old.id}`, "succeeded");
    await reconcilePayment(old.id, later);
    const refund = await db.paymentRefund.findUniqueOrThrow({
      where: { paymentId: old.id },
    });
    expect(refund.revokeAccess).toBe(false);
    await dispatchRefund(refund.id, later);
    const after = await db.subscription.findUniqueOrThrow({
      where: { id: x.sub.id },
      include: { plan: true },
    });
    expect(after.status).toBe("ACTIVE");
    expect(after.currentPeriodEnd).toEqual(before.currentPeriodEnd);
    expect(after.paymentMethodId).toBe(before.paymentMethodId);
    expect(
      allowsAccess(
        { subjectId: f.subject.id, isFree: false },
        { subscriptions: [after], grants: [] },
        later,
        3,
      ),
    ).toBe(true);
  });
});
