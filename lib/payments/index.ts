import type { AppEnv } from "../env";
import { assertDevelopment } from "../providers";
import { MockPayments } from "./mock";
import { YookassaPayments } from "./yookassa";
import type { PaymentsProvider } from "./types";
export * from "./types";
export { MockPayments, DatabaseMockStore } from "./mock";
export { YookassaPayments } from "./yookassa";
export function createPaymentsProvider(env: AppEnv): PaymentsProvider {
  if (env.PAYMENTS_PROVIDER === "yookassa") {
    if (
      !env.YOOKASSA_SHOP_ID ||
      !env.YOOKASSA_SECRET_KEY ||
      !env.YOOKASSA_WEBHOOK_IPS ||
      !env.RECEIPT_VAT_CODE
    )
      throw new Error("Payment provider configuration is incomplete");
    return new YookassaPayments(env);
  }
  assertDevelopment(env);
  return new MockPayments(undefined, env.APP_URL);
}
