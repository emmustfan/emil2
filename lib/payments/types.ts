import { z } from "zod";
export const providerPaymentSchema = z.object({
  id: z.string().min(1).max(128),
  status: z.enum(["pending", "waiting_for_capture", "succeeded", "canceled"]),
  paid: z.boolean(),
  test: z.boolean(),
  amount: z.object({ value: z.string(), currency: z.literal("RUB") }),
  metadata: z.record(z.string(), z.string()).default({}),
  confirmation: z.object({ confirmation_url: z.url().optional() }).optional(),
  payment_method: z
    .object({
      id: z.string(),
      saved: z.boolean(),
      title: z.string().optional(),
      card: z
        .object({ card_type: z.string(), last4: z.string().regex(/^\d{4}$/) })
        .optional(),
    })
    .optional(),
  cancellation_details: z.object({ reason: z.string() }).optional(),
});
export const providerRefundSchema = z.object({
  id: z.string(),
  payment_id: z.string(),
  status: z.enum(["pending", "succeeded", "canceled"]),
  amount: z.object({ value: z.string(), currency: z.literal("RUB") }),
});
export type YkPayment = z.infer<typeof providerPaymentSchema>;
export type YkRefund = z.infer<typeof providerRefundSchema>;
export type Receipt = {
  customer: { email: string };
  items: {
    description: string;
    quantity: "1.00";
    amount: { value: string; currency: "RUB" };
    vat_code: number;
    payment_subject: "service";
    payment_mode: "full_payment";
  }[];
  tax_system_code?: number;
};
export type CreatePaymentInput = {
  amount: { value: string; currency: "RUB" };
  capture: true;
  description: string;
  metadata: Record<string, string>;
  receipt: Receipt;
  confirmation?: { type: "redirect"; return_url: string };
  save_payment_method?: true;
  payment_method_data?: { type: "bank_card" };
  payment_method_id?: string;
};
export type CreateRefundInput = {
  payment_id: string;
  amount: { value: string; currency: "RUB" };
  receipt: Receipt;
};
export interface PaymentsProvider {
  createPayment(
    input: CreatePaymentInput,
    idempotencyKey: string,
  ): Promise<YkPayment>;
  getPayment(id: string): Promise<YkPayment>;
  createRefund(
    input: CreateRefundInput,
    idempotencyKey: string,
  ): Promise<YkRefund>;
  getRefund(id: string): Promise<YkRefund>;
}
