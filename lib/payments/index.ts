import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppEnv } from "../env";
import { assertDevelopment, ProviderNotImplementedError } from "../providers";
export type Payment = {
  id: string;
  amountKopecks: number;
  status: "PENDING" | "SUCCEEDED" | "CANCELED" | "REFUNDED";
};
export interface PaymentsProvider {
  createPayment(
    amountKopecks: number,
    idempotencyKey: string,
  ): Promise<Payment>;
  getPayment(id: string): Promise<Payment>;
}
// Process-local scaffold, not a replacement for database-backed payments in stage 7.
export class MockPayments implements PaymentsProvider {
  private readonly payments = new Map<string, Payment>();
  private readonly requests = new Map<string, string>();
  async createPayment(amountKopecks: number, idempotencyKey: string) {
    z.number().int().positive().parse(amountKopecks);
    z.string().min(1).parse(idempotencyKey);
    const existing = this.requests.get(idempotencyKey);
    if (existing) {
      const payment = await this.getPayment(existing);
      if (payment.amountKopecks !== amountKopecks)
        throw new Error("Idempotency key amount mismatch");
      return payment;
    }
    const payment: Payment = {
      id: randomUUID(),
      amountKopecks,
      status: "PENDING",
    };
    this.payments.set(payment.id, payment);
    this.requests.set(idempotencyKey, payment.id);
    return { ...payment };
  }
  async getPayment(id: string) {
    const payment = this.payments.get(id);
    if (!payment) throw new Error("Payment not found");
    return { ...payment };
  }
}
export function createPaymentsProvider(env: AppEnv): PaymentsProvider {
  if (env.PAYMENTS_PROVIDER !== "mock")
    throw new ProviderNotImplementedError(env.PAYMENTS_PROVIDER);
  assertDevelopment(env);
  return new MockPayments();
}
