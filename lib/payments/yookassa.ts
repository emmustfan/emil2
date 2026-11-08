import { z } from "zod";
import type { AppEnv } from "../env";
import {
  providerPaymentSchema,
  providerRefundSchema,
  type PaymentsProvider,
  type CreatePaymentInput,
  type CreateRefundInput,
} from "./types";
export class YookassaPayments implements PaymentsProvider {
  constructor(
    private env: AppEnv,
    private request: typeof fetch = fetch,
  ) {}
  private async call(path: string, body?: unknown, key?: string) {
    const response = await this.request(`https://api.yookassa.ru/v3/${path}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.env.YOOKASSA_SHOP_ID}:${this.env.YOOKASSA_SECRET_KEY}`).toString("base64")}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotence-Key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error("Payment provider is unavailable");
    return response.json();
  }
  private async verifyMode() {
    const info = z.object({ test: z.boolean() }).parse(await this.call("me"));
    if (info.test !== this.env.YOOKASSA_TEST_MODE)
      throw new Error("Payment shop mode does not match configuration");
  }
  async createPayment(input: CreatePaymentInput, key: string) {
    await this.verifyMode();
    return providerPaymentSchema.parse(await this.call("payments", input, key));
  }
  async getPayment(id: string) {
    return providerPaymentSchema.parse(
      await this.call(`payments/${encodeURIComponent(id)}`),
    );
  }
  async createRefund(input: CreateRefundInput, key: string) {
    await this.verifyMode();
    return providerRefundSchema.parse(await this.call("refunds", input, key));
  }
  async getRefund(id: string) {
    return providerRefundSchema.parse(
      await this.call(`refunds/${encodeURIComponent(id)}`),
    );
  }
}
