import type { Prisma } from "../generated/prisma/client";
import { createQueueClient } from "../../worker/queue";
export const BILLING_SYNC = "billing-sync",
  BILLING_MAIL = "billing-mail",
  BILLING_TICK = "billing-tick";
export type SyncJob = {
  paymentId?: string;
  providerPaymentId?: string;
  refundId?: string;
  providerRefundId?: string;
};
let promise: Promise<ReturnType<typeof createQueueClient>> | null = null;
export function getBillingQueue() {
  promise ??= (async () => {
    const boss = createQueueClient();
    try {
      await boss.start();
      for (const q of [BILLING_SYNC, BILLING_MAIL, BILLING_TICK])
        await boss.createQueue(q);
      return boss;
    } catch (e) {
      await boss.stop();
      promise = null;
      throw e;
    }
  })();
  return promise;
}
export async function enqueueBilling(
  queue: string,
  data: object,
  singletonKey: string,
  tx?: Prisma.TransactionClient,
) {
  const boss = await getBillingQueue();
  await boss.send(queue, data, {
    singletonKey,
    retryLimit: 8,
    retryDelay: 5,
    retryBackoff: true,
    ...(tx
      ? {
          db: {
            executeSql: async (text: string, values?: unknown[]) => ({
              rows: await tx.$queryRawUnsafe<unknown[]>(
                text,
                ...(values ?? []),
              ),
            }),
          },
        }
      : {}),
  });
}
export async function closeBillingQueue() {
  if (promise) {
    const boss = await promise;
    await boss.stop({ graceful: true, timeout: 5000 });
    promise = null;
  }
}
