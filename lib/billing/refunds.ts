import { getDb } from "../db";
import { getEnv } from "../env";
import type { Prisma, Payment } from "../generated/prisma/client";
import { createPaymentsProvider, type CreateRefundInput } from "../payments";
import { AuthError } from "../auth/errors";
import { ContentError } from "../content/errors";
import {
  billingLock,
  receipt,
  billingProvider,
  trustedPayment,
} from "./service";
import { billingConfig, billingContent } from "./config";
import { amountString, parseAmount } from "./policy";
import { enqueueBilling, BILLING_SYNC } from "./jobs";
import { queueBillingMail } from "./mail";
export function refundRequest(p: Payment): CreateRefundInput {
  return {
    payment_id: p.providerPaymentId!,
    amount: { value: amountString(p.amountKopecks), currency: "RUB" },
    receipt: receipt(p.buyerEmail!, p.planTitle, p.amountKopecks),
  };
}
export async function requestRefund(adminId: string, paymentId: string) {
  const initial = await getDb().payment.findUnique({
    where: { id: paymentId },
  });
  if (!initial) throw new ContentError("Платёж не найден.", 404);
  const refund = await getDb().$transaction(
    async (tx) => {
      await billingLock(tx, initial.userId, true);
      const admin = await tx.user.findUnique({ where: { id: adminId } });
      if (admin?.role !== "ADMIN" || admin.blockedAt || admin.deletedAt)
        throw new AuthError("forbidden", 403);
      const p = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      if (p.status !== "SUCCEEDED" && p.status !== "REFUNDED")
        throw new ContentError(
          "Вернуть можно только успешно оплаченный платёж.",
          409,
        );
      const existing = await tx.paymentRefund.findUnique({
        where: { paymentId },
      });
      if (existing) return existing;
      if (!p.buyerEmail)
        throw new ContentError(
          "Платёж обезличен. Возврат и фискальные документы нужно проверить в кабинете платёжного сервиса.",
          409,
        );
      const row = await tx.paymentRefund.create({
        data: {
          paymentId,
          amountKopecks: p.amountKopecks,
          requestedById: adminId,
          providerRequest: refundRequest(
            p,
          ) as unknown as Prisma.InputJsonObject,
        },
      });
      await enqueueBilling(
        BILLING_SYNC,
        { refundId: row.id },
        `refund:${row.id}`,
        tx,
      );
      return row;
    },
    { timeout: 15000 },
  );
  await dispatchRefund(refund.id);
  return getDb().paymentRefund.findUniqueOrThrow({
    where: { id: refund.id },
    select: { id: true, status: true },
  });
}
export async function dispatchRefund(id: string, now = new Date()) {
  const cfg = await billingConfig(),
    initial = await getDb().paymentRefund.findUnique({ where: { id } });
  if (!initial || initial.status !== "PENDING") return;
  const p = await getDb().payment.findUniqueOrThrow({
    where: { id: initial.paymentId },
  });
  if (p.provider !== getEnv().PAYMENTS_PROVIDER)
    throw new Error("Refund provider changed");
  if (initial.providerRefundId) return reconcileRefund(id, now);
  await getDb().paymentRefund.updateMany({
    where: { id, creationStartedAt: null },
    data: { creationStartedAt: now },
  });
  await getDb().$transaction(
    async (tx) => {
      await billingLock(tx, p.userId, true);
      const row = await tx.paymentRefund.findUniqueOrThrow({ where: { id } });
      if (row.status !== "PENDING" || row.providerRefundId) return;
      if (!row.providerRequest)
        throw new ContentError(
          "Обезличенный возврат требует проверки в платёжном сервисе.",
          409,
        );
      if (
        now.getTime() - row.creationStartedAt!.getTime() >=
        cfg.creationTtlHours * 3600000
      )
        throw new Error("Refund creation requires manual verification");
      const remote = await billingProvider(tx).createRefund(
        row.providerRequest as unknown as CreateRefundInput,
        row.id,
      );
      if (
        remote.payment_id !== p.providerPaymentId ||
        parseAmount(remote.amount.value) !== p.amountKopecks
      )
        throw new Error("Invalid refund response");
      await tx.paymentRefund.update({
        where: { id },
        data: { providerRefundId: remote.id },
      });
    },
    { timeout: 15000 },
  );
  await reconcileRefund(id, now);
}
export async function reconcileRefund(id: string, now = new Date()) {
  const row = await getDb().paymentRefund.findUnique({ where: { id } });
  if (!row?.providerRefundId || row.status !== "PENDING") return;
  const p = await getDb().payment.findUniqueOrThrow({
      where: { id: row.paymentId },
    }),
    provider = createPaymentsProvider(getEnv());
  if (p.provider !== getEnv().PAYMENTS_PROVIDER)
    throw new Error("Refund provider mismatch");
  const refund = await provider.getRefund(row.providerRefundId),
    remote = await provider.getPayment(p.providerPaymentId!);
  trustedPayment(p, remote);
  if (
    refund.payment_id !== p.providerPaymentId ||
    refund.id !== row.providerRefundId ||
    parseAmount(refund.amount.value) !== row.amountKopecks ||
    remote.id !== p.providerPaymentId ||
    remote.metadata.paymentId !== p.id ||
    !remote.paid ||
    parseAmount(remote.amount.value) !== p.amountKopecks ||
    remote.test !== (p.provider === "mock" || getEnv().YOOKASSA_TEST_MODE)
  )
    throw new Error("Refund verification failed");
  if (refund.status === "pending") return;
  const text = await billingContent();
  await getDb().$transaction(
    async (tx) => {
      const user = await billingLock(tx, p.userId, true),
        current = await tx.paymentRefund.findUniqueOrThrow({ where: { id } });
      if (current.status !== "PENDING") return;
      await tx.paymentRefund.update({
        where: { id },
        data: { status: refund.status.toUpperCase(), finishedAt: now },
      });
      if (refund.status !== "succeeded") return;
      await tx.payment.update({
        where: { id: p.id },
        data: { status: "REFUNDED", refundedAt: now },
      });
      if (current.revokeAccess && p.subscriptionId)
        await tx.subscription.update({
          where: { id: p.subscriptionId },
          data: {
            status: "EXPIRED",
            autoRenew: false,
            canceledAt: now,
            revokedAt: now,
            nextRetryAt: null,
          },
        });
      await queueBillingMail(tx, {
        key: `refunded:${p.id}`,
        userId: user.id,
        referenceId: p.id,
        kind: "refunded",
        email: p.buyerEmail,
        title: current.revokeAccess ? text.refunded : text.refundedExtra,
        plan: p.planTitle,
        amount: p.amountKopecks,
        end: null,
        timezone: user.timezone,
      });
    },
    { timeout: 15000 },
  );
}
