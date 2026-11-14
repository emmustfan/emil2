import { getDb } from "../db";
import { getEnv } from "../env";
import type { Prisma } from "../generated/prisma/client";
import { createPaymentsProvider, MockPayments } from "../payments";
import { billingConfig, billingContent } from "./config";
import {
  billingLock,
  billingProvider,
  dispatchPayment,
  reconcilePayment,
  paymentRequest,
  trustedPayment,
} from "./service";
import { dispatchRefund, reconcileRefund } from "./refunds";
import { queueBillingMail } from "./mail";
import {
  enqueueBilling,
  BILLING_SYNC,
  BILLING_MAIL,
  type SyncJob,
} from "./jobs";
import { chargeAt } from "./policy";
export async function billingTick(now = new Date()) {
  const cfg = await billingConfig(),
    text = await billingContent();
  const subs = await getDb().subscription.findMany({
    where: { status: { in: ["ACTIVE", "PAST_DUE"] } },
    select: { id: true, userId: true },
  });
  for (const initial of subs)
    await getDb().$transaction(
      async (tx) => {
        const user = await billingLock(tx, initial.userId, true),
          sub = await tx.subscription.findUniqueOrThrow({
            where: { id: initial.id },
            include: { plan: true },
          });
        if (sub.status === "EXPIRED") return;
        if (
          user.blockedAt ||
          user.deletedAt ||
          !sub.renewalConsentedAt ||
          !sub.paymentMethodId
        ) {
          if (sub.autoRenew)
            await tx.subscription.update({
              where: { id: sub.id },
              data: { autoRenew: false, nextRetryAt: null },
            });
          if (sub.currentPeriodEnd > now) return;
        }
        const renewable =
          sub.autoRenew &&
          !!sub.renewalConsentedAt &&
          !!sub.paymentMethodId &&
          !user.blockedAt &&
          !user.deletedAt;
        if (
          (!renewable && sub.currentPeriodEnd <= now) ||
          (sub.status === "PAST_DUE" &&
            now.getTime() >=
              sub.currentPeriodEnd.getTime() + cfg.graceDays * 86400000)
        ) {
          await tx.subscription.update({
            where: { id: sub.id },
            data: { status: "EXPIRED", autoRenew: false, nextRetryAt: null },
          });
          await queueBillingMail(tx, {
            key: `expired:${sub.id}:${sub.currentPeriodEnd.toISOString()}`,
            userId: user.id,
            referenceId: sub.id,
            kind: "expired",
            email: sub.buyerEmail,
            title: text.expired,
            plan: sub.plan.title,
            amount: sub.priceKopecks,
            end: sub.currentPeriodEnd,
            timezone: user.timezone,
          });
          return;
        }
        if (!renewable || !sub.buyerEmail || sub.revokedAt) return;
        const planned = chargeAt(sub.currentPeriodEnd, cfg.leadHours);
        if (
          sub.status === "ACTIVE" &&
          now.getTime() >= planned.getTime() - cfg.reminderDays * 86400000 &&
          now < planned
        )
          await queueBillingMail(tx, {
            key: `reminder:${sub.id}:${sub.currentPeriodEnd.toISOString()}`,
            userId: user.id,
            referenceId: sub.id,
            kind: "reminder",
            email: sub.buyerEmail,
            title: `${text.reminder} — ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: user.timezone }).format(planned)}`,
            plan: sub.plan.title,
            amount: sub.priceKopecks,
            end: sub.currentPeriodEnd,
            timezone: user.timezone,
          });
        if (
          sub.status === "ACTIVE"
            ? now < planned
            : !sub.nextRetryAt || now < sub.nextRetryAt
        )
          return;
        if (
          await tx.payment.count({
            where: {
              subscriptionId: sub.id,
              status: "PENDING",
              cycleEnd: sub.currentPeriodEnd,
            },
          })
        )
          return;
        const key = `renew:${sub.id}:${sub.currentPeriodEnd.toISOString()}:${sub.failedAttempts}`;
        let payment = await tx.payment.findUnique({
          where: { requestKey: key },
        });
        if (!payment) {
          payment = await tx.payment.create({
            data: {
              userId: sub.userId,
              subscriptionId: sub.id,
              planId: sub.planId,
              subjectId: sub.subjectId,
              scopeKey: sub.scopeKey,
              amountKopecks: sub.priceKopecks,
              periodMonths: sub.periodMonths,
              planTitle: sub.plan.title,
              buyerEmail: sub.buyerEmail,
              provider: getEnv().PAYMENTS_PROVIDER,
              requestKey: key,
              isRecurring: true,
              cycleEnd: sub.currentPeriodEnd,
              attempt: sub.failedAttempts,
              renewalConsentedAt: sub.renewalConsentedAt,
              renewalConsentVersion: sub.renewalConsentVersion,
              offerVersion: sub.offerVersion,
            },
          });
          payment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              providerRequest: paymentRequest(
                payment,
                sub.plan.code,
                sub.paymentMethodId!,
              ) as unknown as Prisma.InputJsonObject,
            },
          });
        }
        if (payment.status === "PENDING")
          await enqueueBilling(
            BILLING_SYNC,
            { paymentId: payment.id },
            `create:${payment.id}`,
            tx,
          );
      },
      { timeout: 15000 },
    );
  // Recover transport failures, missed notifications and a worker restart.
  for (const p of await getDb().payment.findMany({
    where: { status: "PENDING" },
    select: { id: true },
  }))
    await enqueueBilling(BILLING_SYNC, { paymentId: p.id }, `recover:${p.id}`);
  for (const r of await getDb().paymentRefund.findMany({
    where: { status: "PENDING" },
    select: { id: true },
  }))
    await enqueueBilling(
      BILLING_SYNC,
      { refundId: r.id },
      `recover-refund:${r.id}`,
    );
  const unsent = await getDb().billingMail.findMany({
    where: { sentAt: null },
    select: { key: true, userId: true },
  });
  const available = new Set(
    (
      await getDb().user.findMany({
        where: { id: { in: unsent.map((m) => m.userId) }, deletedAt: null },
        select: { id: true },
      })
    ).map((u) => u.id),
  );
  for (const mail of unsent)
    if (available.has(mail.userId))
      await enqueueBilling(
        BILLING_MAIL,
        { key: mail.key },
        `mail-recover:${mail.key}`,
      );
}
export async function syncBillingJob(job: SyncJob, now = new Date()) {
  if (job.paymentId) return dispatchPayment(job.paymentId, now);
  if (job.refundId) return dispatchRefund(job.refundId, now);
  if (job.providerPaymentId) {
    const remote = await createPaymentsProvider(getEnv()).getPayment(
      job.providerPaymentId,
    );
    const p = await getDb().payment.findUnique({
      where: { id: remote.metadata.paymentId ?? "" },
    });
    if (
      !p ||
      p.provider !== "yookassa" ||
      remote.metadata.userId !== p.userId ||
      (p.providerPaymentId && p.providerPaymentId !== remote.id)
    )
      return;
    trustedPayment({ ...p, providerPaymentId: remote.id }, remote);
    // A notification can arrive before createPayment's HTTP response is committed.
    if (!p.providerPaymentId)
      await getDb().payment.updateMany({
        where: { id: p.id, providerPaymentId: null },
        data: { providerPaymentId: remote.id },
      });
    return reconcilePayment(p.id, now);
  }
  if (job.providerRefundId) {
    const remote = await createPaymentsProvider(getEnv()).getRefund(
      job.providerRefundId,
    );
    let row = await getDb().paymentRefund.findUnique({
      where: { providerRefundId: remote.id },
    });
    if (!row) {
      const p = await getDb().payment.findUnique({
        where: { providerPaymentId: remote.payment_id },
      });
      if (!p || p.provider !== "yookassa") return;
      row = await getDb().paymentRefund.findUnique({
        where: { paymentId: p.id },
      });
      if (!row)
        row = await getDb().paymentRefund.create({
          data: {
            paymentId: p.id,
            providerRefundId: remote.id,
            amountKopecks: p.amountKopecks,
          },
        });
      else if (!row.providerRefundId)
        row = await getDb().paymentRefund.update({
          where: { id: row.id },
          data: { providerRefundId: remote.id },
        });
    }
    return reconcileRefund(row.id, now);
  }
}
export async function settleMockPayment(
  paymentId: string,
  status: "succeeded" | "canceled",
  ownerId?: string,
) {
  const env = getEnv();
  if (env.PAYMENTS_PROVIDER !== "mock" || env.NODE_ENV === "production")
    throw new Error("Mock payments are unavailable");
  const p = await getDb().payment.findUniqueOrThrow({
    where: { id: paymentId },
  });
  if (ownerId && p.userId !== ownerId) throw new Error("Payment not found");
  if (!p.providerPaymentId) await dispatchPayment(p.id);
  await getDb().$transaction(
    async (tx) => {
      await billingLock(tx, p.userId);
      await (billingProvider(tx) as MockPayments).settle(
        (await tx.payment.findUniqueOrThrow({ where: { id: p.id } }))
          .providerPaymentId!,
        status,
      );
    },
    { timeout: 15000 },
  );
  await reconcilePayment(p.id);
}
