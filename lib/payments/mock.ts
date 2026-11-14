import { createHash } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import { getDb } from "../db";
import { amountString, parseAmount } from "../billing/policy";
import {
  providerPaymentSchema,
  providerRefundSchema,
  type PaymentsProvider,
  type CreatePaymentInput,
  type CreateRefundInput,
  type YkPayment,
} from "./types";
export interface MockStore {
  get(id: string): Promise<unknown>;
  put(id: string, data: Record<string, unknown>): Promise<unknown>;
  replace(id: string, data: Record<string, unknown>): Promise<void>;
}
export class DatabaseMockStore implements MockStore {
  constructor(private db?: Prisma.TransactionClient) {}
  async get(id: string) {
    return (
      await (this.db ?? getDb()).mockProviderRecord.findUnique({
        where: { id },
      })
    )?.data;
  }
  async put(id: string, data: Record<string, unknown>) {
    return (
      await (this.db ?? getDb()).mockProviderRecord.upsert({
        where: { id },
        create: { id, data: data as Prisma.InputJsonObject },
        update: {},
      })
    ).data;
  }
  async replace(id: string, data: Record<string, unknown>) {
    await (this.db ?? getDb()).mockProviderRecord.update({
      where: { id },
      data: { data: data as Prisma.InputJsonObject },
    });
  }
}
export class MockPayments implements PaymentsProvider {
  constructor(
    private store: MockStore = new DatabaseMockStore(),
    private appUrl = "http://localhost:3000",
  ) {}
  async setRenewalOutcome(
    methodId: string,
    status: "pending" | "succeeded" | "canceled",
  ) {
    const key = `rule:${methodId}`;
    await this.store.put(key, { status });
    await this.store.replace(key, { status });
  }
  async createPayment(input: CreatePaymentInput, key: string) {
    amountString(parseAmount(input.amount.value));
    if (!key) throw new Error("Missing idempotency key");
    const id = `mock_${key}`,
      fingerprint = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
    const outcome = input.payment_method_id
      ? ((
          (await this.store.get(`rule:${input.payment_method_id}`)) as
            { status?: "pending" | "succeeded" | "canceled" } | undefined
        )?.status ?? "succeeded")
      : "pending";
    const payment: YkPayment = {
      id,
      status: outcome,
      paid: outcome === "succeeded",
      test: true,
      amount: input.amount,
      metadata: input.metadata,
      confirmation: {
        confirmation_url: `${this.appUrl}/dev/mock-pay/${encodeURIComponent(key)}`,
      },
      ...(input.payment_method_id
        ? {
            payment_method: {
              id: input.payment_method_id,
              saved: true,
              title: "Тестовая карта •• 0000",
            },
          }
        : {}),
    };
    const record = (await this.store.put(id, { fingerprint, payment })) as {
      fingerprint: string;
      payment: unknown;
    };
    if (record.fingerprint !== fingerprint)
      throw new Error("Idempotency key mismatch");
    return providerPaymentSchema.parse(record.payment);
  }
  async getPayment(id: string) {
    const row = (await this.store.get(id)) as { payment?: unknown } | undefined;
    if (!row?.payment) throw new Error("Payment not found");
    return providerPaymentSchema.parse(row.payment);
  }
  async settle(id: string, status: "succeeded" | "canceled") {
    const current = await this.getPayment(id);
    if (current.status !== "pending") {
      if (current.status !== status)
        throw new Error("Payment is already final");
      return current;
    }
    const payment = {
      ...current,
      status,
      paid: status === "succeeded",
      ...(status === "succeeded"
        ? {
            payment_method: {
              id: current.payment_method?.id ?? `method_${id}`,
              saved: true,
              title: "Тестовая карта •• 0000",
            },
          }
        : { cancellation_details: { reason: "canceled_by_mock" } }),
    };
    const row = (await this.store.get(id)) as Record<string, unknown>;
    await this.store.replace(id, { ...row, payment });
    return providerPaymentSchema.parse(payment);
  }
  async createRefund(input: CreateRefundInput, key: string) {
    const payment = await this.getPayment(input.payment_id);
    if (
      payment.status !== "succeeded" ||
      input.amount.value !== payment.amount.value
    )
      throw new Error("Only a full paid refund is supported");
    const id = `refund_${key}`,
      fingerprint = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
    const refund = {
      id,
      payment_id: payment.id,
      amount: input.amount,
      status: "succeeded",
    };
    const record = (await this.store.put(id, { fingerprint, refund })) as {
      fingerprint: string;
      refund: unknown;
    };
    if (record.fingerprint !== fingerprint)
      throw new Error("Idempotency key mismatch");
    return providerRefundSchema.parse(record.refund);
  }
  async getRefund(id: string) {
    const record = (await this.store.get(id)) as
      { refund?: unknown } | undefined;
    if (!record?.refund) throw new Error("Refund not found");
    return providerRefundSchema.parse(record.refund);
  }
}
