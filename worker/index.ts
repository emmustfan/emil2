import {
  closeBillingQueue,
  BILLING_SYNC,
  BILLING_MAIL,
  BILLING_TICK,
  type SyncJob,
} from "../lib/billing/jobs";
import { billingTick, syncBillingJob } from "../lib/billing/worker";
import { deliverBillingMail } from "../lib/billing/mail";
import { createQueueClient, SMOKE_QUEUE } from "./queue";
import { logger } from "../lib/logger";
import { CONTENT_INDEX_QUEUE } from "../lib/content/jobs";
import {
  indexTopic,
  embeddingIdentity,
  type IndexJob,
} from "../lib/tutor/indexing";
import { getDb } from "../lib/db";
const boss = createQueueClient();
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await closeBillingQueue();
  await boss.stop({ graceful: true, timeout: 10000 });
  await getDb().$disconnect();
  logger.info("worker_stopped");
}
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
try {
  await boss.start();
  await boss.createQueue(SMOKE_QUEUE);
  for (const q of [BILLING_SYNC, BILLING_MAIL, BILLING_TICK])
    await boss.createQueue(q);
  await boss.work<SyncJob>(
    BILLING_SYNC,
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await syncBillingJob(job.data);
        } catch {
          throw new Error("billing_sync_failed");
        }
      }
    },
  );
  await boss.work<{ key: string }>(
    BILLING_MAIL,
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await deliverBillingMail(job.data.key);
        } catch {
          throw new Error("billing_mail_failed");
        }
      }
    },
  );
  await boss.work(BILLING_TICK, async () => {
    try {
      await billingTick();
    } catch {
      throw new Error("billing_tick_failed");
    }
  });
  await boss.schedule(
    BILLING_TICK,
    "0 * * * *",
    {},
    { retryLimit: 3, retryDelay: 30 },
  );
  await boss.send(
    BILLING_TICK,
    {},
    { singletonKey: "startup", retryLimit: 3, retryDelay: 30 },
  );
  await boss.createQueue(CONTENT_INDEX_QUEUE);
  await boss.work<IndexJob>(
    CONTENT_INDEX_QUEUE,
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) await indexTopic(job.data);
    },
  );
  // Existing publications and a changed embedding model also need an index.
  const model = embeddingIdentity();
  for (const topic of await getDb().topic.findMany({
    where: { status: "PUBLISHED", subject: { status: "PUBLISHED" } },
    select: { id: true, subjectId: true, version: true },
  })) {
    const exists = await getDb().contentChunk.count({
      where: {
        topicId: topic.id,
        topicVersion: topic.version,
        embeddingModel: model,
      },
    });
    if (!exists)
      await boss.send(
        CONTENT_INDEX_QUEUE,
        {
          topicId: topic.id,
          subjectId: topic.subjectId,
          version: topic.version,
        },
        {
          singletonKey: `${topic.id}:${topic.version}:${model}`,
          retryLimit: 3,
          retryDelay: 5,
          retryBackoff: true,
        },
      );
  }
  await boss.work<{ source: string }>(
    SMOKE_QUEUE,
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs)
        logger.info({ jobId: job.id }, "foundation_job_completed");
      return { handled: true };
    },
  );
  logger.info("worker_ready");
} catch (error) {
  logger.error(
    { error: error instanceof Error ? error.message : "unknown" },
    "worker_start_failed",
  );
  await boss.stop();
  process.exitCode = 1;
}
