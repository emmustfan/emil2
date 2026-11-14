import { formatPrice } from "../lib/lessons/catalog";
import { getEnv } from "../lib/env";
export function billingMailText(
  title: string,
  plan: string,
  amount: number,
  end: Date | null,
  timezone: string,
) {
  return `${title}\n\nТариф: ${plan}. Сумма: ${formatPrice(amount)}.\n${end ? `Оплачено до: ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: timezone }).format(end)}.\n` : ""}\nУправление подпиской и отмена автопродления: ${getEnv().APP_URL}/cabinet/subscription\nПравила возврата: ${getEnv().APP_URL}/legal/refund\n${getEnv().PAYMENTS_PROVIDER === "mock" || getEnv().YOOKASSA_TEST_MODE ? "Тестовая операция, реальные деньги не списываются. Фискальный чек не формируется." : "Чек направляет платёжный сервис на указанную при оплате почту."}`;
}
export function mailHtml(text: string) {
  return `<html lang="ru"><body>${text
    .split("\n")
    .map(
      (line) =>
        `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") || "&nbsp;"}</p>`,
    )
    .join("")}</body></html>`;
}
