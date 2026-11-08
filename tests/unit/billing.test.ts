import { decodeSetting } from "../../lib/settings/defaults";
import { describe, it, expect, vi } from "vitest";
import {
  amountString,
  parseAmount,
  addMonths,
  nextRetry,
  allowedWebhookIp,
  safePricingReturn,
} from "../../lib/billing/policy";
import { checkoutSchema } from "../../lib/billing/service";
import { MockPayments } from "../../lib/payments/mock";
import { YookassaPayments } from "../../lib/payments/yookassa";
import { MemoryMockStore, providerInput } from "../helpers/payments";
import { parseEnv } from "../../lib/env";
import { mailHtml } from "../../emails/billing";
import {
  upgradeBillingCopy,
  OLD_PAYMENT_NOTE,
  PAYMENT_FAQ_UPDATES,
} from "../../lib/landing/upgrade-billing";
describe("billing policy and provider contracts", () => {
  it("represents money with integer kopecks and fixed decimal strings", () => {
    expect(amountString(59900)).toBe("599.00");
    expect(amountString(101)).toBe("1.01");
    expect(parseAmount("1490.01")).toBe(149001);
    for (const n of [-1, 0, 1.2, NaN]) expect(() => amountString(n)).toThrow();
    for (const value of ["1", "1.001", "1e3", "-1.00", "1,00"])
      expect(() => parseAmount(value)).toThrow();
  });
  it("adds calendar months without rolling January 31 into March", () => {
    expect(addMonths(new Date("2028-01-31T12:34:56Z"), 1).toISOString()).toBe(
      "2028-02-29T12:34:56.000Z",
    );
    expect(addMonths(new Date("2027-01-31T12:34:56Z"), 1).toISOString()).toBe(
      "2027-02-28T12:34:56.000Z",
    );
    expect(addMonths(new Date("2026-12-01T01:00:00Z"), 1).toISOString()).toBe(
      "2027-01-01T01:00:00.000Z",
    );
  });
  it("bounds the renewal lead window and unknown-payment retries to prevent accidental repeated debits", () => {
    expect(decodeSetting("billing.renewalLeadHours", 100000)).toBe(24);
    expect(decodeSetting("billing.creationTtlHours", 48)).toBe(23);
    expect(decodeSetting("billing.renewalLeadHours", 1)).toBe(1);
  });
  it("schedules retries from the first failure, then stops after three attempts", () => {
    const first = new Date("2026-11-08T10:00:00Z");
    expect(nextRetry(first, 1, [24, 72])?.toISOString()).toBe(
      "2026-11-09T10:00:00.000Z",
    );
    expect(nextRetry(first, 2, [24, 72])?.toISOString()).toBe(
      "2026-11-11T10:00:00.000Z",
    );
    expect(nextRetry(first, 3, [24, 72])).toBeNull();
  });
  it("matches explicit IPv4/IPv6 webhook ranges and rejects forwarded lists and invalid masks", () => {
    const ranges = "192.0.2.0/24,2001:db8::/32";
    expect(allowedWebhookIp("192.0.2.1", ranges)).toBe(true);
    expect(allowedWebhookIp("::ffff:192.0.2.1", ranges)).toBe(true);
    expect(allowedWebhookIp("2001:db8::1", ranges)).toBe(true);
    for (const ip of ["127.0.0.1", "unknown", "192.0.2.1, 127.0.0.1"])
      expect(allowedWebhookIp(ip, ranges)).toBe(false);
    expect(allowedWebhookIp("192.0.2.1", "192.0.2.0/999")).toBe(false);
    expect(allowedWebhookIp("192.0.2.1", "")).toBe(false);
  });
  it("retains only an internal pricing destination across login", () => {
    expect(safePricingReturn("/pricing?plan=subject_month&subject=s")).toBe(
      "/pricing?plan=subject_month&subject=s",
    );
    for (const path of [
      "https://evil.test",
      "//evil.test",
      "/pricing/../../admin",
      "/pricing-other",
      "/admin",
    ])
      expect(safePricingReturn(path)).toBe("/cabinet");
  });
  it("requires explicit renewal consent and rejects client-supplied ownership", () => {
    const body = {
      requestId: crypto.randomUUID(),
      planCode: "subject_month",
      subjectId: "s",
      amountKopecks: 59900,
      periodMonths: 1,
      buyerEmail: "payer@example.test",
      renewalConsent: true,
      renewalConsentVersion: "1",
      offerVersion: "0.1",
    };
    expect(checkoutSchema.safeParse(body).success).toBe(true);
    expect(
      checkoutSchema.safeParse({ ...body, renewalConsent: false }).success,
    ).toBe(false);
    expect(
      checkoutSchema.safeParse({ ...body, userId: "forged" }).success,
    ).toBe(false);
  });
  it("persists mock operations across provider instances and refunds a payment once", async () => {
    const store = new MemoryMockStore(),
      a = new MockPayments(store),
      b = new MockPayments(store),
      first = await a.createPayment(providerInput(), "p");
    expect(await b.createPayment(providerInput(), "p")).toEqual(first);
    await b.settle(first.id, "succeeded");
    expect((await a.getPayment(first.id)).paid).toBe(true);
    await expect(a.settle(first.id, "canceled")).rejects.toThrow();
    const body = {
      payment_id: first.id,
      amount: first.amount,
      receipt: providerInput().receipt,
    };
    const r = await a.createRefund(body, "r");
    expect(await b.createRefund(body, "r")).toEqual(r);
    expect((await b.getRefund(r.id)).status).toBe("succeeded");
  });
  it("sends typed YooKassa requests with credentials, stable keys and receipt, without logging provider errors", async () => {
    const env = parseEnv({
      DATABASE_URL: "postgresql://app:app@localhost/app",
      PAYMENTS_PROVIDER: "yookassa",
      YOOKASSA_SHOP_ID: "fixture-shop",
      YOOKASSA_SECRET_KEY: "fixture-secret",
      YOOKASSA_WEBHOOK_IPS: "192.0.2.0/24",
      RECEIPT_VAT_CODE: "1",
    });
    const input = providerInput(),
      remote = {
        id: "provider-id",
        status: "pending",
        paid: false,
        test: true,
        amount: input.amount,
        metadata: input.metadata,
      };
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(JSON.stringify(remote), { status: 200 }),
      );
    const provider = new YookassaPayments(env, request);
    await provider.createPayment(input, "payment-row-id");
    expect(request.mock.calls[0][0]).toBe("https://api.yookassa.ru/v3/me");
    const [url, options] = request.mock.calls[1];
    expect(url).toBe("https://api.yookassa.ru/v3/payments");
    expect(options?.headers).toMatchObject({
      "Idempotence-Key": "payment-row-id",
      Authorization: `Basic ${Buffer.from("fixture-shop:fixture-secret").toString("base64")}`,
    });
    expect(JSON.parse(options?.body as string)).toEqual(input);
    request.mockResolvedValueOnce(
      new Response("PRIVATE_PROVIDER_BODY", { status: 500 }),
    );
    await expect(provider.getPayment("id")).rejects.toThrow(
      "Payment provider is unavailable",
    );
  });
  it("refuses a live shop when test mode is selected before creating a charge", async () => {
    const env = parseEnv({
      DATABASE_URL: "postgresql://app:app@localhost/app",
    });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ test: false }), { status: 200 }),
      );
    await expect(
      new YookassaPayments(env, request).createPayment(providerInput(), "key"),
    ).rejects.toThrow("mode");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]?.method).toBe("GET");
  });
  it("escapes transactional email HTML and upgrades only untouched landing copy", () => {
    expect(mailHtml('<script>"x"</script>&')).not.toContain("<script>");
    const result = upgradeBillingCopy({
      paymentNote: OLD_PAYMENT_NOTE,
      faq: [
        { question: "q", answer: PAYMENT_FAQ_UPDATES[0][0] },
        { question: "own", answer: "Свой текст владельца" },
      ],
    });
    expect(result.paymentNote).not.toBe(OLD_PAYMENT_NOTE);
    expect(result.faq[0].answer).toBe(PAYMENT_FAQ_UPDATES[0][1]);
    expect(result.faq[1].answer).toBe("Свой текст владельца");
    expect(
      upgradeBillingCopy({ paymentNote: "Свои условия", faq: [] }),
    ).toEqual({ paymentNote: "Свои условия", faq: [] });
  });
});
