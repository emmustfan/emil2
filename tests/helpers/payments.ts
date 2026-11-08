import type { MockStore } from "../../lib/payments/mock";
import type { CreatePaymentInput } from "../../lib/payments/types";
export class MemoryMockStore implements MockStore {
  private rows = new Map<string, Record<string, unknown>>();
  async get(id: string) {
    return structuredClone(this.rows.get(id));
  }
  async put(id: string, data: Record<string, unknown>) {
    if (!this.rows.has(id)) this.rows.set(id, structuredClone(data));
    return this.get(id);
  }
  async replace(id: string, data: Record<string, unknown>) {
    this.rows.set(id, structuredClone(data));
  }
}
export function providerInput(amount = "1.00"): CreatePaymentInput {
  return {
    amount: { value: amount, currency: "RUB" },
    capture: true,
    description: "Тестовый доступ",
    metadata: {
      paymentId: "payment-test",
      userId: "user-test",
      planCode: "subject_month",
    },
    confirmation: {
      type: "redirect",
      return_url: "https://school.test/checkout/return?paymentId=payment-test",
    },
    save_payment_method: true,
    receipt: {
      customer: { email: "buyer@example.test" },
      items: [
        {
          description: "Тестовый доступ",
          quantity: "1.00",
          amount: { value: amount, currency: "RUB" },
          vat_code: 1,
          payment_subject: "service",
          payment_mode: "full_payment",
        },
      ],
    },
  };
}
