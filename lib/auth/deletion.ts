import { Prisma } from "../generated/prisma/client";
import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { getEnv } from "../env";
import { lockRoleAccess } from "./role-lock";
import { lock } from "./session";
import { protectedOwner } from "./roles";
import { ContentError } from "../content/errors";
import { deletionError } from "../admin/policy";
export const PRIVACY_TICK = "privacy-tick";
async function accountLocks(tx: Prisma.TransactionClient, id: string) {
  await lock(tx, `billing:user:${id}`);
  await lock(tx, `learning:user:${id}`);
  await lock(tx, `srs:user:${id}`);
  await lock(tx, `usage:tutor:user:${id}`);
}
export async function requestAccountDeletion(id: string, now = new Date()) {
  await getDb().$transaction(
    async (tx) => {
      await lockRoleAccess(tx, true);
      await accountLocks(tx, id);
      const user = await tx.user.findUniqueOrThrow({ where: { id } });
      if (user.deletedAt) return;
      const otherAdmins = await tx.user.count({
        where: {
          id: { not: id },
          role: "ADMIN",
          blockedAt: null,
          deletedAt: null,
        },
      });
      const denied = deletionError(
        protectedOwner(user.email, getEnv().ADMIN_EMAILS),
        user.role === "ADMIN" && otherAdmins === 0,
      );
      if (denied) throw new ContentError(denied, 409);
      await tx.user.update({
        where: { id },
        data: {
          deletedAt: now,
          telegramNotify: false,
          roleRevision: { increment: 1 },
        },
      });
      await tx.subscription.updateMany({
        where: { userId: id },
        data: {
          autoRenew: false,
          nextRetryAt: null,
          paymentMethodId: null,
          paymentMethodTitle: null,
          canceledAt: now,
        },
      });
      await tx.payment.updateMany({
        where: {
          userId: id,
          status: "PENDING",
          providerPaymentId: null,
          creationStartedAt: null,
        },
        data: {
          status: "CANCELED",
          cancellationReason: "account_deleted_before_dispatch",
        },
      });
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.loginToken.updateMany({
        where: {
          OR: [
            { intentUserId: id },
            ...(user.email ? [{ email: user.email }] : []),
          ],
        },
        data: { usedAt: now },
      });
      await tx.teacherSubject.deleteMany({ where: { teacherId: id } });
      await tx.securityAudit.create({
        data: {
          actorId: id,
          targetId: id,
          action: "ACCOUNT_DELETION_REQUESTED",
          changes: { requestedAt: now.toISOString() },
        },
      });
    },
    { timeout: 15000 },
  );
}
// Runs hourly and on worker startup. No physical deletion of the financial ledger.
export async function anonymizeAccount(id: string, now = new Date()) {
  return getDb().$transaction(
    async (tx) => {
      await lockRoleAccess(tx, true);
      await accountLocks(tx, id);
      const user = await tx.user.findUnique({ where: { id } });
      if (!user?.deletedAt || user.anonymizedAt) return false;
      const financialPending = await tx.payment.count({
        where: {
          userId: id,
          OR: [
            { status: "PENDING" },
            { refund: { is: { status: "PENDING" } } },
          ],
        },
      });
      // Leave a day of margin for the hourly job before the maximum 30-day deadline.
      if (financialPending && +now - +user.deletedAt < 29 * 86400000)
        return false;
      const demos = await tx.demoSession.findMany({
          where: { userId: id },
          select: { id: true, anonId: true },
        }),
        demoIds = demos.map((d) => d.id);
      const owner = {
        OR: [{ userId: id }, { demoSessionId: { in: demoIds } }],
      };
      await tx.tutorMessage.deleteMany({ where: { conversation: owner } });
      await tx.tutorConversation.deleteMany({ where: owner });
      await tx.reviewLog.deleteMany({ where: { card: owner } });
      await tx.card.deleteMany({ where: owner });
      await tx.questionAttempt.deleteMany({ where: { testRun: owner } });
      await tx.testRun.deleteMany({ where: owner });
      await tx.gapAnswer.deleteMany({ where: owner });
      await tx.topicProgress.deleteMany({ where: { userId: id } });
      await tx.demoSession.deleteMany({ where: { id: { in: demoIds } } });
      await tx.usageCounter.deleteMany({
        where: {
          actorKey: { in: [`user:${id}`, ...demoIds.map((d) => `demo:${d}`)] },
        },
      });
      await tx.event.updateMany({
        where: {
          OR: [
            { userId: id },
            {
              anonId: {
                in: [
                  ...demos.map((d) => d.anonId),
                  ...(user.anonId ? [user.anonId] : []),
                ],
              },
            },
          ],
        },
        data: {
          userId: null,
          anonId: randomUUID(),
          props: Prisma.DbNull,
          dedupeKey: null,
        },
      });
      await tx.loginToken.deleteMany({
        where: {
          OR: [
            { intentUserId: id },
            ...(user.email ? [{ email: user.email }] : []),
          ],
        },
      });
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.featureInterest.deleteMany({
        where: {
          OR: [{ userId: id }, ...(user.email ? [{ email: user.email }] : [])],
        },
      });
      await tx.promoCode.updateMany({
        where: { userId: id },
        data: { userId: null, validUntil: now },
      });
      await tx.accessGrant.updateMany({
        where: { userId: id },
        data: { reason: null, expiresAt: now },
      });
      await tx.accessGrant.updateMany({
        where: { grantedById: id },
        data: { reason: null },
      });
      await tx.billingMail.deleteMany({ where: { userId: id } });
      const payments = await tx.payment.findMany({
        where: { userId: id },
        select: { id: true, providerPaymentId: true, providerRequest: true },
      });
      for (const p of payments) {
        const request = p.providerRequest as Prisma.JsonObject | null;
        // Keep only metadata needed to verify a late provider notification, no receipt/card.
        await tx.payment.update({
          where: { id: p.id },
          data: {
            buyerEmail: null,
            raw: Prisma.DbNull,
            confirmationUrl: null,
            providerRequest: request?.metadata
              ? { metadata: request.metadata as Prisma.InputJsonValue }
              : Prisma.DbNull,
          },
        });
      }
      await tx.paymentRefund.updateMany({
        where: { payment: { userId: id } },
        data: { providerRequest: Prisma.DbNull },
      });
      await tx.paymentRefund.updateMany({
        where: { requestedById: id },
        data: { requestedById: null },
      });
      await tx.subscription.updateMany({
        where: { userId: id },
        data: {
          buyerEmail: null,
          paymentMethodId: null,
          paymentMethodTitle: null,
          autoRenew: false,
          nextRetryAt: null,
        },
      });
      await tx.teacherSubject.deleteMany({ where: { teacherId: id } });
      await tx.teacherSubject.updateMany({
        where: { assignedById: id },
        data: { assignedById: null },
      });
      await tx.securityAudit.updateMany({
        where: { OR: [{ actorId: id }, { targetId: id }] },
        data: { actorId: null, targetId: null, changes: { anonymized: true } },
      });
      await tx.user.update({
        where: { id },
        data: {
          email: null,
          emailVerifiedAt: null,
          telegramId: null,
          telegramUsername: null,
          telegramNotify: false,
          vkId: null,
          name: null,
          university: null,
          course: null,
          goal: null,
          timezone: "Europe/Moscow",
          utm: Prisma.DbNull,
          anonId: null,
          diagnostic: Prisma.DbNull,
          consentPdAt: null,
          consentPdVersion: null,
          offerVersion: null,
          role: "USER",
          anonymizedAt: now,
        },
      });
      if (financialPending)
        await tx.securityAudit.create({
          data: {
            action: "ANONYMIZED_PAYMENT_REQUIRES_REVIEW",
            changes: { paymentIds: payments.map((p) => p.id) },
          },
        });
      return true;
    },
    { timeout: 30000 },
  );
}
export async function privacyTick(now = new Date()) {
  const rows = await getDb().user.findMany({
    where: { deletedAt: { not: null }, anonymizedAt: null },
    select: { id: true },
  });
  for (const row of rows) await anonymizeAccount(row.id, now);
}
