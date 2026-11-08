import { z } from "zod";
import { getDb } from "../db";
import type { Prisma, Payment } from "../generated/prisma/client";
import { getEnv } from "../env";
import { lock } from "../auth/session";
import { lockRoleAccess } from "../auth/role-lock";
import { AuthError } from "../auth/errors";
import { currentLegal } from "../auth/legal";
import { ContentError } from "../content/errors";
import { consumeLimit } from "../access";
import { track } from "../analytics/events";
import {
  createPaymentsProvider,
  MockPayments,
  DatabaseMockStore,
  type CreatePaymentInput,
  type YkPayment,
} from "../payments";
import { billingConfig, billingContent, cancellationMessage } from "./config";
import {
  amountString,
  parseAmount,
  addMonths,
  scopeKey,
  nextRetry,
} from "./policy";
import { enqueueBilling, BILLING_SYNC } from "./jobs";
import { queueBillingMail } from "./mail";
type Db = Prisma.TransactionClient;
export const checkoutSchema = z
  .object({
    requestId: z.uuid(),
    planCode: z.string().min(1).max(100),
    subjectId: z.string().min(1).max(128).optional(),
    amountKopecks: z.number().int().positive(),
    periodMonths: z.number().int().min(1).max(120),
    buyerEmail: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    renewalConsent: z.literal(true),
    renewalConsentVersion: z.string().max(100),
    offerVersion: z.string().max(100),
  })
  .strict();
export function billingProvider(tx?: Db) {
  const env = getEnv();
  return env.PAYMENTS_PROVIDER === "mock"
    ? new MockPayments(new DatabaseMockStore(tx), env.APP_URL)
    : createPaymentsProvider(env);
}
export async function billingUser(tx: Db, id: string) {
  const user = await tx.user.findUnique({ where: { id } });
  if (!user || user.blockedAt || user.deletedAt)
    throw new AuthError("forbidden", 403);
  return user;
}
export async function billingLock(tx: Db, userId: string, financial = false) {
  await lockRoleAccess(tx);
  await lock(tx, `billing:user:${userId}`);
  return financial
    ? tx.user.findUniqueOrThrow({ where: { id: userId } })
    : billingUser(tx, userId);
}
export function receipt(email: string, title: string, amount: number) {
  const env = getEnv();
  return {
    customer: { email },
    items: [
      {
        description: title.slice(0, 128),
        quantity: "1.00" as const,
        amount: { value: amountString(amount), currency: "RUB" as const },
        vat_code: env.RECEIPT_VAT_CODE ?? 1,
        payment_subject: "service" as const,
        payment_mode: "full_payment" as const,
      },
    ],
    ...(env.RECEIPT_TAX_SYSTEM_CODE
      ? { tax_system_code: env.RECEIPT_TAX_SYSTEM_CODE }
      : {}),
  };
}
export function paymentRequest(
  payment: Pick<
    Payment,
    "id" | "userId" | "subjectId" | "amountKopecks" | "buyerEmail" | "planTitle"
  >,
  planCode: string,
  method?: string,
): CreatePaymentInput {
  return {
    amount: { value: amountString(payment.amountKopecks), currency: "RUB" },
    capture: true,
    description: payment.planTitle.slice(0, 128),
    metadata: {
      paymentId: payment.id,
      userId: payment.userId,
      planCode,
      ...(payment.subjectId ? { subjectId: payment.subjectId } : {}),
    },
    receipt: receipt(
      payment.buyerEmail!,
      payment.planTitle,
      payment.amountKopecks,
    ),
    ...(method
      ? { payment_method_id: method }
      : {
          confirmation: {
            type: "redirect",
            return_url: `${getEnv().APP_URL}/checkout/return?paymentId=${encodeURIComponent(payment.id)}`,
          },
          save_payment_method: true,
          payment_method_data: { type: "bank_card" },
        }),
  };
}
export async function startCheckout(
  userId: string,
  raw: unknown,
  now = new Date(),
) {
  const input = checkoutSchema.parse(raw),
    cfg = await billingConfig(),
    text = await billingContent(),
    legal = await currentLegal();
  if (
    input.offerVersion !== legal.offer.version ||
    input.renewalConsentVersion !== text.version
  )
    throw new ContentError(
      "Условия обновлены. Перезагрузите страницу тарифов.",
      409,
    );
  if (
    getEnv().PAYMENTS_PROVIDER === "yookassa" &&
    !getEnv().YOOKASSA_TEST_MODE
  ) {
    const docs = await getDb().legalDocument.findMany({
      where: {
        kind: { in: ["oferta", "privacy", "consent", "refund"] },
        publishedAt: { lte: now },
      },
      orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
    });
    if (
      ["oferta", "privacy", "consent", "refund"].some((kind) => {
        const doc = docs.find((d) => d.kind === kind);
        return (
          !doc ||
          doc.version === "0.1" ||
          doc.contentMd.includes("Текст готовит юрист")
        );
      })
    )
      throw new ContentError(
        "Оплата будет подключена после подготовки юридических документов.",
        503,
      );
  }
  await consumeLimit(`user:${userId}`, {
    feature: "checkout",
    max: cfg.requestsPerMinute,
    periodStart: new Date(Math.floor(now.getTime() / 60000) * 60000),
  });
  const payment = await getDb().$transaction(
    async (tx) => {
      const user = await billingLock(tx, userId);
      if (
        !user.consentPdAt ||
        user.consentPdVersion !== legal.consent.version ||
        user.offerVersion !== legal.offer.version
      )
        throw new AuthError("forbidden", 403);
      const key = `${userId}:${input.requestId}`;
      const existing = await tx.payment.findUnique({
        where: { requestKey: key },
      });
      if (existing) {
        const plan = await tx.plan.findUniqueOrThrow({
          where: { id: existing.planId },
        });
        if (
          existing.userId !== userId ||
          plan.code !== input.planCode ||
          existing.subjectId !== (input.subjectId ?? null) ||
          existing.amountKopecks !== input.amountKopecks ||
          existing.periodMonths !== input.periodMonths ||
          existing.buyerEmail !== input.buyerEmail
        )
          throw new ContentError(
            "Этот запрос уже относится к другой оплате.",
            409,
          );
        return existing;
      }
      const plan = await tx.plan.findUnique({
        where: { code: input.planCode },
      });
      if (
        !plan?.isActive ||
        plan.kind === "FREE" ||
        plan.priceKopecks <= 0 ||
        plan.periodMonths < 1
      )
        throw new ContentError("Тариф недоступен.", 409);
      if (
        plan.priceKopecks !== input.amountKopecks ||
        plan.periodMonths !== input.periodMonths
      )
        throw new ContentError(
          "Стоимость изменилась. Обновите страницу и проверьте сумму.",
          409,
        );
      const subject = input.subjectId
        ? await tx.subject.findFirst({
            where: { id: input.subjectId, status: "PUBLISHED" },
          })
        : null;
      if (
        (plan.kind === "SUBJECT" && !subject) ||
        (plan.kind === "ALL_SUBJECTS" && input.subjectId)
      )
        throw new ContentError(
          "Выберите опубликованный предмет для этого тарифа.",
          422,
        );
      const scope = scopeKey(userId, plan.kind, subject?.id ?? null);
      const active = await tx.subscription.findFirst({
        where: {
          userId,
          AND: [
            {
              OR: [
                { scopeKey: scope },
                {
                  scopeKey: null,
                  subjectId: subject?.id ?? null,
                  plan: { kind: plan.kind },
                },
                ...(plan.kind === "SUBJECT"
                  ? [{ plan: { kind: "ALL_SUBJECTS" as const } }]
                  : [{ plan: { kind: "SUBJECT" as const } }]),
              ],
            },
            {
              OR: [
                { status: "ACTIVE", currentPeriodEnd: { gt: now } },
                {
                  status: "PAST_DUE",
                  currentPeriodEnd: {
                    gt: new Date(now.getTime() - cfg.graceDays * 86400000),
                  },
                },
              ],
            },
          ],
        },
      });
      if (active)
        throw new ContentError(
          plan.kind === "ALL_SUBJECTS" && active.subjectId
            ? "Смена предметного тарифа на общий доступна после оплаченного срока. Следующие списания можно отключить в кабинете."
            : "У вас уже есть подписка с этим доступом. Управляйте ей в кабинете.",
          409,
        );
      const pending = await tx.payment.findFirst({
        where: {
          userId,
          scopeKey: scope,
          isRecurring: false,
          status: "PENDING",
        },
        orderBy: { createdAt: "desc" },
      });
      if (pending) {
        if (
          pending.amountKopecks !== input.amountKopecks ||
          pending.buyerEmail !== input.buyerEmail ||
          pending.periodMonths !== input.periodMonths
        )
          throw new ContentError(
            "Есть незавершённая оплата с другими условиями. Проверьте её в разделе подписки.",
            409,
          );
        return pending;
      }
      const row = await tx.payment.create({
        data: {
          userId,
          planId: plan.id,
          subjectId: subject?.id,
          provider: getEnv().PAYMENTS_PROVIDER,
          requestKey: key,
          scopeKey: scope,
          amountKopecks: plan.priceKopecks,
          periodMonths: plan.periodMonths,
          planTitle: plan.title,
          buyerEmail: input.buyerEmail,
          renewalConsentedAt: now,
          renewalConsentVersion: text.version,
          offerVersion: legal.offer.version,
        },
      });
      const saved = await tx.payment.update({
        where: { id: row.id },
        data: {
          providerRequest: paymentRequest(
            row,
            plan.code,
          ) as unknown as Prisma.InputJsonObject,
        },
      });
      await enqueueBilling(
        BILLING_SYNC,
        { paymentId: row.id },
        `create:${row.id}`,
        tx,
      );
      await track(
        "checkout_started",
        { planCode: plan.code, amount: row.amountKopecks },
        { userId },
        tx,
        `checkout:${row.id}`,
      );
      return saved;
    },
    { timeout: 15000 },
  );
  await dispatchPayment(payment.id, now);
  return paymentStatus(userId, payment.id, false);
}
export function trustedPayment(payment: Payment, remote: YkPayment) {
  if (
    remote.id !== payment.providerPaymentId ||
    remote.metadata.paymentId !== payment.id ||
    remote.metadata.userId !== payment.userId ||
    (remote.metadata.subjectId ?? null) !== payment.subjectId ||
    remote.metadata.planCode !==
      (payment.providerRequest as unknown as CreatePaymentInput)?.metadata
        ?.planCode ||
    parseAmount(remote.amount.value) !== payment.amountKopecks ||
    remote.test !== (payment.provider === "mock" || getEnv().YOOKASSA_TEST_MODE)
  )
    throw new ContentError("Платёж требует дополнительной проверки.", 409);
}
function confirmation(payment: Payment, remote: YkPayment) {
  const value = remote.confirmation?.confirmation_url;
  if (!value) return null;
  const url = new URL(value);
  if (payment.provider === "mock") {
    if (
      url.origin !== new URL(getEnv().APP_URL).origin ||
      url.pathname !== `/dev/mock-pay/${payment.id}`
    )
      throw new Error("Invalid mock confirmation");
  } else if (
    url.protocol !== "https:" ||
    !["yoomoney.ru", "yookassa.ru"].some(
      (h) => url.hostname === h || url.hostname.endsWith(`.${h}`),
    )
  )
    throw new Error("Invalid payment confirmation");
  return value;
}
export async function dispatchPayment(id: string, now = new Date()) {
  const cfg = await billingConfig();
  const initial = await getDb().payment.findUnique({ where: { id } });
  if (!initial || initial.status !== "PENDING" || !initial.providerRequest)
    return;
  if (initial.provider !== getEnv().PAYMENTS_PROVIDER)
    throw new Error("Payment provider configuration changed");
  if (initial.providerPaymentId) return reconcilePayment(id, now);
  await getDb().$transaction(async (tx) => {
    await billingLock(tx, initial.userId);
    const p = await tx.payment.findUniqueOrThrow({ where: { id } });
    if (!p.creationStartedAt)
      await tx.payment.update({
        where: { id },
        data: { creationStartedAt: now },
      });
  });
  await getDb().$transaction(
    async (tx) => {
      const user = await billingLock(tx, initial.userId),
        payment = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (payment.status !== "PENDING" || payment.providerPaymentId) return;
      if (
        now.getTime() - payment.creationStartedAt!.getTime() >=
        cfg.creationTtlHours * 3600000
      )
        throw new ContentError(
          "Не удалось уточнить состояние оплаты. Требуется проверка поддержки.",
          409,
        );
      if (payment.isRecurring) {
        const sub = await tx.subscription.findUnique({
          where: { id: payment.subscriptionId! },
        });
        if (
          !sub ||
          !sub.autoRenew ||
          sub.revokedAt ||
          !sub.renewalConsentedAt ||
          sub.currentPeriodEnd.getTime() !== payment.cycleEnd?.getTime() ||
          user.blockedAt ||
          user.deletedAt
        )
          return;
      }
      const remote = await billingProvider(tx).createPayment(
        payment.providerRequest as unknown as CreatePaymentInput,
        payment.id,
      );
      const bound = { ...payment, providerPaymentId: remote.id };
      trustedPayment(bound, remote);
      await tx.payment.update({
        where: { id },
        data: {
          providerPaymentId: remote.id,
          confirmationUrl: confirmation(bound, remote),
        },
      });
    },
    { timeout: 15000 },
  );
  const bound = await getDb().payment.findUniqueOrThrow({ where: { id } });
  if (bound.providerPaymentId) await reconcilePayment(id, now);
}
export async function reconcilePayment(id: string, now = new Date()) {
  const payment = await getDb().payment.findUnique({ where: { id } });
  if (!payment?.providerPaymentId || payment.status !== "PENDING") return;
  if (payment.provider !== getEnv().PAYMENTS_PROVIDER)
    throw new Error("Payment provider mismatch");
  const remote = await createPaymentsProvider(getEnv()).getPayment(
    payment.providerPaymentId,
  );
  trustedPayment(payment, remote);
  if (remote.status === "pending" || remote.status === "waiting_for_capture")
    return;
  if (remote.status === "succeeded" && !remote.paid)
    throw new Error("Unpaid provider success");
  const text = await billingContent(),
    cfg = await billingConfig();
  await getDb().$transaction(
    async (tx) => {
      const user = await billingLock(tx, payment.userId, true),
        p = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (p.status !== "PENDING") return;
      const plan = await tx.plan.findUniqueOrThrow({ where: { id: p.planId } });
      const sub = p.subscriptionId
        ? await tx.subscription.findUnique({ where: { id: p.subscriptionId } })
        : await tx.subscription.findUnique({
            where: { scopeKey: p.scopeKey! },
          });
      if (remote.status === "canceled") {
        await tx.payment.update({
          where: { id },
          data: {
            status: "CANCELED",
            cancellationReason:
              remote.cancellation_details?.reason ?? "canceled",
            raw: remote as unknown as Prisma.InputJsonObject,
          },
        });
        if (
          p.isRecurring &&
          sub &&
          sub.currentPeriodEnd.getTime() === p.cycleEnd?.getTime() &&
          sub.autoRenew &&
          !sub.revokedAt
        ) {
          const failures = sub.failedAttempts + 1,
            first = sub.firstFailedAt ?? now,
            retry = nextRetry(first, failures, cfg.retryHours);
          await tx.subscription.update({
            where: { id: sub.id },
            data: {
              status: retry ? "PAST_DUE" : "EXPIRED",
              failedAttempts: failures,
              firstFailedAt: first,
              nextRetryAt: retry,
              ...(!retry ? { autoRenew: false } : {}),
            },
          });
          await queueBillingMail(tx, {
            key: `failed:${id}`,
            userId: user.id,
            referenceId: id,
            kind: "failed",
            email: p.buyerEmail,
            title: text.failed,
            plan: p.planTitle,
            amount: p.amountKopecks,
            end: sub.currentPeriodEnd,
            timezone: user.timezone,
          });
          if (!retry)
            await queueBillingMail(tx, {
              key: `expired:${sub.id}:${p.cycleEnd!.toISOString()}`,
              userId: user.id,
              referenceId: sub.id,
              kind: "expired",
              email: p.buyerEmail,
              title: text.expired,
              plan: p.planTitle,
              amount: p.amountKopecks,
              end: sub.currentPeriodEnd,
              timezone: user.timezone,
            });
        }
        await track(
          "payment_failed",
          {
            planCode: plan.code,
            amount: p.amountKopecks,
            isRecurring: p.isRecurring,
          },
          { userId: p.userId },
          tx,
          `payment-failed:${id}`,
        );
        return;
      }
      if (
        p.isRecurring &&
        sub &&
        (sub.revokedAt ||
          sub.currentPeriodEnd.getTime() !== p.cycleEnd?.getTime())
      ) {
        await tx.payment.update({
          where: { id },
          data: {
            status: "SUCCEEDED",
            paidAt: now,
            raw: remote as unknown as Prisma.InputJsonObject,
          },
        });
        const refund = await tx.paymentRefund.upsert({
          where: { paymentId: id },
          create: {
            paymentId: id,
            revokeAccess: false,
            amountKopecks: p.amountKopecks,
            providerRequest: {
              payment_id: p.providerPaymentId!,
              amount: { value: amountString(p.amountKopecks), currency: "RUB" },
              receipt: receipt(p.buyerEmail!, p.planTitle, p.amountKopecks),
            } as unknown as Prisma.InputJsonObject,
          },
          update: {},
        });
        await enqueueBilling(
          BILLING_SYNC,
          { refundId: refund.id },
          `refund:${refund.id}`,
          tx,
        );
        await track(
          "payment_succeeded",
          { planCode: plan.code, amount: p.amountKopecks, isRecurring: true },
          { userId: p.userId },
          tx,
          `payment-paid:${id}`,
        );
        return;
      }
      const end = addMonths(
        new Date(Math.max(now.getTime(), sub?.currentPeriodEnd.getTime() ?? 0)),
        p.periodMonths,
      );
      const method = remote.payment_method?.saved
        ? remote.payment_method
        : null;
      const methodTitle = method?.card
        ? `${method.card.card_type} •• ${method.card.last4}`
        : method
          ? p.provider === "mock"
            ? "Тестовая карта •• 0000"
            : "Сохранённый способ оплаты"
          : null;
      const data = {
        planId: p.planId,
        subjectId: p.subjectId,
        scopeKey: p.scopeKey,
        status: "ACTIVE" as const,
        currentPeriodStart:
          sub && sub.currentPeriodEnd > now ? sub.currentPeriodStart : now,
        currentPeriodEnd: end,
        periodMonths: p.periodMonths,
        priceKopecks: p.amountKopecks,
        buyerEmail: p.buyerEmail,
        paymentMethodId: method?.id ?? null,
        paymentMethodTitle: methodTitle,
        autoRenew:
          !user.blockedAt &&
          !user.deletedAt &&
          (p.isRecurring ? !!sub?.autoRenew && !!method : !!method),
        renewalConsentedAt: p.renewalConsentedAt,
        renewalConsentVersion: p.renewalConsentVersion,
        offerVersion: p.offerVersion,
        failedAttempts: 0,
        firstFailedAt: null,
        nextRetryAt: null,
        revokedAt: null,
        ...(p.isRecurring ? {} : { canceledAt: null }),
      };
      const activated = sub
        ? await tx.subscription.update({ where: { id: sub.id }, data })
        : await tx.subscription.create({ data: { ...data, userId: p.userId } });
      await tx.payment.update({
        where: { id },
        data: {
          status: "SUCCEEDED",
          paidAt: now,
          subscriptionId: activated.id,
          raw: remote as unknown as Prisma.InputJsonObject,
        },
      });
      await track(
        "payment_succeeded",
        {
          planCode: plan.code,
          amount: p.amountKopecks,
          isRecurring: p.isRecurring,
        },
        { userId: p.userId },
        tx,
        `payment-paid:${id}`,
      );
      await queueBillingMail(tx, {
        key: `paid:${id}`,
        userId: user.id,
        referenceId: id,
        kind: "paid",
        email: p.buyerEmail,
        title: text.paid,
        plan: p.planTitle,
        amount: p.amountKopecks,
        end,
        timezone: user.timezone,
      });
    },
    { timeout: 15000 },
  );
}
export async function paymentStatus(
  userId: string,
  id: string,
  refresh = true,
) {
  const p = await getDb().payment.findFirst({ where: { id, userId } });
  if (!p) throw new ContentError("Платёж не найден.", 404);
  if (refresh && p.status === "PENDING") {
    if (p.providerPaymentId) await reconcilePayment(id);
    else await dispatchPayment(id);
  }
  const current = await getDb().payment.findFirstOrThrow({
    where: { id, userId },
    include: {
      subject: { select: { slug: true } },
      refund: { select: { status: true, revokeAccess: true } },
    },
  });
  const canceledCopy =
    current.status === "CANCELED" ? await billingContent() : null;
  return {
    cancellationMessage: canceledCopy
      ? cancellationMessage(current.cancellationReason, canceledCopy)
      : null,
    id: current.id,
    status: current.status,
    amountKopecks: current.amountKopecks,
    title: current.planTitle,
    isRecurring: current.isRecurring,
    confirmationUrl:
      current.status === "PENDING" ? current.confirmationUrl : null,
    refundPending: current.refund?.status === "PENDING",
    refundRevokesAccess: current.refund?.revokeAccess ?? true,
    href: current.subject ? `/subjects/${current.subject.slug}` : "/subjects",
  };
}
export async function cancelSubscription(
  userId: string,
  id: string,
  now = new Date(),
) {
  const text = await billingContent();
  await getDb().$transaction(
    async (tx) => {
      const user = await billingLock(tx, userId),
        sub = await tx.subscription.findFirst({
          where: { id, userId },
          include: { plan: true },
        });
      if (!sub) throw new ContentError("Подписка не найдена.", 404);
      if (!sub.autoRenew) return;
      await tx.subscription.update({
        where: { id },
        data: {
          autoRenew: false,
          canceledAt: now,
          nextRetryAt: null,
          ...(sub.currentPeriodEnd <= now ? { status: "EXPIRED" } : {}),
        },
      });
      await tx.payment.updateMany({
        where: {
          subscriptionId: id,
          isRecurring: true,
          status: "PENDING",
          providerPaymentId: null,
          creationStartedAt: null,
        },
        data: {
          status: "CANCELED",
          cancellationReason: "renewal_disabled_before_dispatch",
        },
      });
      await track(
        "subscription_canceled",
        { planCode: sub.plan.code },
        { userId },
        tx,
        `cancel:${id}:${sub.currentPeriodEnd.toISOString()}`,
      );
      await queueBillingMail(tx, {
        key: `cancel:${id}:${sub.currentPeriodEnd.toISOString()}`,
        userId,
        referenceId: id,
        kind: "canceled",
        email: sub.buyerEmail,
        title: text.canceled,
        plan: sub.plan.title,
        amount: sub.priceKopecks,
        end: sub.currentPeriodEnd,
        timezone: user.timezone,
      });
    },
    { timeout: 15000 },
  );
}
