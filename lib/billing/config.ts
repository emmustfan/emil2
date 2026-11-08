import { z } from "zod";
import { getDb } from "../db";
import { decodeSetting } from "../settings/defaults";
export async function billingConfig() {
  const rows = await getDb().appSetting.findMany({
    where: { key: { startsWith: "billing." } },
  });
  const read = <K extends Parameters<typeof decodeSetting>[0]>(key: K) =>
    decodeSetting(key, rows.find((r) => r.key === key)?.value);
  return {
    leadHours: read("billing.renewalLeadHours") as number,
    retryHours: read("billing.retryHours") as number[],
    reminderDays: read("billing.reminderDaysBefore") as number,
    graceDays: read("billing.graceDays") as number,
    requestsPerMinute: read("billing.requestsPerMinute") as number,
    hookPerMinute: read("billing.webhookRequestsPerMinute") as number,
    creationTtlHours: read("billing.creationTtlHours") as number,
    pollSeconds: read("billing.returnPollSeconds") as number,
  };
}
export const CANCEL_REASONS: Record<string, string> = {
  canceled_by_mock: "Тестовый платёж отклонён.",
  insufficient_funds: "На карте недостаточно средств.",
  card_expired: "Срок действия карты истёк.",
  permission_revoked: "Разрешение на списание отозвано.",
  payment_expired: "Время на оплату истекло.",
  other: "Платёжный сервис отменил эту попытку. Доступ по ней не открывался.",
};
export const billingContentSchema = z.object({
  version: z.string(),
  cancelReasons: z.record(z.string(), z.string()).default(CANCEL_REASONS),
  renewal: z.string(),
  mockNotice: z.string(),
  testShopNotice: z
    .string()
    .default(
      "Тестовый магазин ЮKassa: реальные деньги не списываются. Для проверки используйте тестовые данные из документации ЮKassa.",
    ),
  paid: z.string(),
  failed: z.string(),
  canceled: z.string(),
  expired: z.string(),
  reminder: z.string(),
  refunded: z.string(),
  refundedExtra: z.string().default("Лишний платёж возвращён"),
});
export const BILLING_CONTENT = {
  version: "1",
  cancelReasons: CANCEL_REASONS,
  renewal:
    "Соглашаюсь на автопродление: указанная сумма списывается раз в указанный период. Автопродление можно отключить в кабинете; оплаченный доступ сохранится до конца срока.",
  mockNotice:
    "Тестовая оплата: реальные деньги не списываются. Данные банковской карты вводить не нужно.",
  testShopNotice:
    "Тестовый магазин ЮKassa: реальные деньги не списываются. Для проверки используйте тестовые данные из документации ЮKassa.",
  paid: "Оплата прошла — доступ открыт",
  failed: "Не удалось продлить подписку",
  canceled: "Автопродление отключено",
  expired: "Подписка закончилась",
  reminder: "Скоро продление подписки",
  refunded: "Возврат выполнен — подписка закрыта",
  refundedExtra: "Лишний платёж возвращён",
};
export async function billingContent() {
  const row = await getDb().landingContent.findUnique({
    where: { key: "billing.v1" },
  });
  const parsed = billingContentSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : BILLING_CONTENT;
}

export function cancellationMessage(
  reason: string | null,
  content: Awaited<ReturnType<typeof billingContent>>,
) {
  return reason && Object.hasOwn(content.cancelReasons, reason)
    ? content.cancelReasons[reason]
    : (content.cancelReasons.other ?? CANCEL_REASONS.other);
}
