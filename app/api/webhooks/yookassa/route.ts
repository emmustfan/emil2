import { reportFault } from "@/lib/monitoring";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { hashToken } from "@/lib/auth/crypto";
import { readInput, clientIp } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/errors";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { consumeLimit } from "@/lib/access";
import { allowedWebhookIp } from "@/lib/billing/policy";
import { billingConfig } from "@/lib/billing/config";
import { enqueueBilling, BILLING_SYNC } from "@/lib/billing/jobs";
export async function POST(request: NextRequest) {
  try {
    const env = getEnv(),
      ip = clientIp(request);
    if (
      env.PAYMENTS_PROVIDER !== "yookassa" ||
      !allowedWebhookIp(ip, env.YOOKASSA_WEBHOOK_IPS)
    )
      throw new AuthError("forbidden", 403);
    const cfg = await billingConfig();
    await consumeLimit(`billing-hook:${hashToken(ip)}`, {
      feature: "billing-hook",
      max: cfg.hookPerMinute,
      periodStart: new Date(Math.floor(Date.now() / 60000) * 60000),
    });
    const body = z
      .object({
        type: z.literal("notification"),
        event: z.enum([
          "payment.succeeded",
          "payment.canceled",
          "refund.succeeded",
        ]),
        object: z
          .object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) })
          .passthrough(),
      })
      .passthrough()
      .parse(await readInput(request, 65536));
    await enqueueBilling(
      BILLING_SYNC,
      body.event === "refund.succeeded"
        ? { providerRefundId: body.object.id }
        : { providerPaymentId: body.object.id },
      `hook:${body.event}:${body.object.id}`,
    );
    return contentJSON({ ok: true });
  } catch (e) {
    if (!(e instanceof AuthError) && !(e instanceof z.ZodError))
      await reportFault("webhook_failed", e);
    return contentFailure(e);
  }
}
