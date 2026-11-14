import "dotenv/config";
import { settleMockPayment } from "../../lib/billing/worker";
import { closeBillingQueue } from "../../lib/billing/jobs";
import { getDb } from "../../lib/db";
import { getEnv } from "../../lib/env";
const [id, status] = process.argv.slice(2);
try {
  if (
    getEnv().NODE_ENV === "production" ||
    getEnv().PAYMENTS_PROVIDER !== "mock"
  )
    throw new Error("Симуляция разрешена только для тестового провайдера.");
  if (!id || !["succeeded", "canceled"].includes(status))
    throw new Error(
      "Использование: pnpm webhook:simulate <paymentId> succeeded|canceled",
    );
  await settleMockPayment(id, status as "succeeded" | "canceled");
  console.info(
    "Тестовый платёж обработан тем же сервисом, что уведомление провайдера.",
  );
} finally {
  await closeBillingQueue();
  await getDb().$disconnect();
}
