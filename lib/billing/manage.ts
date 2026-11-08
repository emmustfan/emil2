import { z } from "zod";
import type { Prisma } from "../generated/prisma/client";
import { getDb } from "../db";
import { ContentError } from "../content/errors";
import { currentLegal } from "../auth/legal";
import { billingContent } from "./config";
import {
  billingLock,
  dispatchPayment,
  paymentRequest,
  paymentStatus,
} from "./service";
import { enqueueBilling, BILLING_SYNC } from "./jobs";
import { getEnv } from "../env";
import { track } from "../analytics/events";
export const renewalInput = z
  .object({
    confirm: z.literal(true),
    renewalConsent: z.literal(true),
    renewalConsentVersion: z.string().max(100),
    offerVersion: z.string().max(100),
  })
  .strict();
export async function resumeRenewal(
  userId: string,
  id: string,
  raw: unknown,
  now = new Date(),
) {
  const input = renewalInput.parse(raw),
    text = await billingContent(),
    legal = await currentLegal();
  if (
    input.renewalConsentVersion !== text.version ||
    input.offerVersion !== legal.offer.version
  )
    throw new ContentError("Условия обновлены. Перезагрузите страницу.", 409);
  await getDb().$transaction(async (tx) => {
    const user = await billingLock(tx, userId),
      s = await tx.subscription.findFirst({ where: { id, userId } });
    if (
      !user.consentPdAt ||
      user.consentPdVersion !== legal.consent.version ||
      user.offerVersion !== legal.offer.version
    )
      throw new ContentError("Подтвердите актуальные условия платформы.", 403);
    if (
      !s ||
      s.status !== "ACTIVE" ||
      s.currentPeriodEnd <= now ||
      s.revokedAt ||
      !s.paymentMethodId
    )
      throw new ContentError(
        "Возобновление недоступно. Выберите оплату на странице тарифов.",
        409,
      );
    await tx.subscription.update({
      where: { id },
      data: {
        autoRenew: true,
        canceledAt: null,
        renewalConsentedAt: now,
        renewalConsentVersion: input.renewalConsentVersion,
        offerVersion: input.offerVersion,
      },
    });
  });
}
export async function unlinkPaymentMethod(
  userId: string,
  id: string,
  now = new Date(),
) {
  await getDb().$transaction(async (tx) => {
    await billingLock(tx, userId);
    const s = await tx.subscription.findFirst({ where: { id, userId } });
    if (!s) throw new ContentError("Подписка не найдена.", 404);
    await tx.subscription.update({
      where: { id },
      data: {
        paymentMethodId: null,
        paymentMethodTitle: null,
        autoRenew: false,
        canceledAt: now,
        nextRetryAt: null,
        ...(s.currentPeriodEnd <= now ? { status: "EXPIRED" as const } : {}),
      },
    });
    await tx.payment.updateMany({
      where: {
        subscriptionId: id,
        isRecurring: true,
        manualRenewal: false,
        status: "PENDING",
        providerPaymentId: null,
        creationStartedAt: null,
      },
      data: {
        status: "CANCELED",
        cancellationReason: "renewal_disabled_before_dispatch",
      },
    });
    await tx.securityAudit.create({
      data: {
        actorId: userId,
        targetId: userId,
        action: "PAYMENT_METHOD_UNLINKED",
        changes: { subscriptionId: id },
      },
    });
  });
}
export async function manualRenewal(
  userId: string,
  id: string,
  now = new Date(),
) {
  const row = await getDb().$transaction(
    async (tx) => {
      const user = await billingLock(tx, userId),
        s = await tx.subscription.findFirst({
          where: { id, userId },
          include: { plan: true },
        });
      if (
        !s ||
        s.status !== "PAST_DUE" ||
        s.revokedAt ||
        !s.buyerEmail ||
        !s.renewalConsentedAt
      )
        throw new ContentError(
          "Ручная оплата доступна для подписки с неудачным продлением.",
          409,
        );
      const pending = await tx.payment.findFirst({
        where: { subscriptionId: id, status: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      if (pending) {
        if (pending.manualRenewal) return pending;
        if (pending.creationStartedAt || pending.providerPaymentId)
          throw new ContentError(
            "Уже проверяется предыдущее списание. Дождитесь его результата.",
            409,
          );
        await tx.payment.update({
          where: { id: pending.id },
          data: {
            status: "CANCELED",
            cancellationReason: "replaced_with_manual_payment",
          },
        });
      }
      const p = await tx.payment.create({
        data: {
          userId,
          subscriptionId: id,
          planId: s.planId,
          subjectId: s.subjectId,
          scopeKey: s.scopeKey,
          amountKopecks: s.priceKopecks,
          periodMonths: s.periodMonths,
          planTitle: s.plan.title,
          buyerEmail: s.buyerEmail,
          provider: getEnv().PAYMENTS_PROVIDER,
          isRecurring: true,
          manualRenewal: true,
          cycleEnd: s.currentPeriodEnd,
          renewalConsentedAt: s.renewalConsentedAt,
          renewalConsentVersion: s.renewalConsentVersion,
          offerVersion: s.offerVersion,
        },
      });
      const saved = await tx.payment.update({
        where: { id: p.id },
        data: {
          providerRequest: paymentRequest(
            p,
            s.plan.code,
          ) as unknown as Prisma.InputJsonObject,
        },
      });
      await enqueueBilling(
        BILLING_SYNC,
        { paymentId: p.id },
        `create:${p.id}`,
        tx,
      );
      await track(
        "checkout_started",
        { planCode: s.plan.code, amount: s.priceKopecks },
        { userId: user.id },
        tx,
        `checkout:${p.id}`,
      );
      return saved;
    },
    { timeout: 15000 },
  );
  await dispatchPayment(row.id, now);
  return paymentStatus(userId, row.id, false);
}
