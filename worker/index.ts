import { heartbeat } from "../lib/monitoring/health";
import { budgetTick } from "../lib/monitoring/usage";
import { reportFault } from "../lib/monitoring";
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
import { processImport, importTick } from "../lib/imports/worker";
import {
  CONTENT_IMPORT_QUEUE,
  IMPORT_TICK,
  closeContentQueue,
} from "../lib/content/jobs";
import { CONTENT_INDEX_QUEUE } from "../lib/content/jobs";
import {
  indexTopic,
  embeddingIdentity,
  type IndexJob,
} from "../lib/tutor/indexing";
import { getDb } from "../lib/db";
import { PRIVACY_TICK, privacyTick } from "../lib/auth/deletion";
const boss = createQueueClient();
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await closeBillingQueue();
  await closeContentQueue();
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
  await boss.createQueue(PRIVACY_TICK);
  await boss.work(PRIVACY_TICK, async () => {
    try {
      await privacyTick();
    } catch (error) {
      await reportFault("privacy_failed", error);
      throw new Error("privacy_tick_failed");
    }
  });
  await boss.schedule(
    PRIVACY_TICK,
    "15 * * * *",
    {},
    { retryLimit: 3, retryDelay: 30 },
  );
  await boss.send(
    PRIVACY_TICK,
    {},
    { singletonKey: "startup", retryLimit: 3, retryDelay: 30 },
  );
  for (const q of [BILLING_SYNC, BILLING_MAIL, BILLING_TICK])
    await boss.createQueue(q);
  await boss.work<SyncJob>(
    BILLING_SYNC,
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await syncBillingJob(job.data);
        } catch (error) {
          await reportFault("billing_sync_failed", error);
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
        } catch (error) {
          await reportFault("billing_mail_failed", error);
          throw new Error("billing_mail_failed");
        }
      }
    },
  );
  await boss.work(BILLING_TICK, async () => {
    try {
      await billingTick();
    } catch (error) {
      await reportFault("billing_tick_failed", error);
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
  await boss.createQueue("monitoring-budget");
  await boss.work("monitoring-budget", async () => {
    await budgetTick();
  });
  await boss.schedule(
    "monitoring-budget",
    "*/15 * * * *",
    {},
    { retryLimit: 2, retryDelay: 30 },
  );
  await boss.createQueue(CONTENT_IMPORT_QUEUE);
  await boss.createQueue(IMPORT_TICK);
  await boss.work<{ id: string }>(
    CONTENT_IMPORT_QUEUE,
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) await processImport(job.data.id);
    },
  );
  await boss.work(IMPORT_TICK, async () => {
    await importTick();
  });
  await boss.schedule(
    IMPORT_TICK,
    "* * * * *",
    {},
    { retryLimit: 2, retryDelay: 30 },
  );
  await boss.send(
    IMPORT_TICK,
    {},
    { singletonKey: "startup", retryLimit: 2, retryDelay: 30 },
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
  await boss.createQueue("monitoring-heartbeat");
  await boss.work("monitoring-heartbeat", async () => {
    await heartbeat();
  });
  await boss.schedule(
    "monitoring-heartbeat",
    "* * * * *",
    {},
    { retryLimit: 2, retryDelay: 10 },
  );
  await heartbeat();
  logger.info("worker_ready");
} catch (error) {
  await reportFault("worker_failed", error);
  logger.error({ code: "worker_failed" }, "worker_start_failed");
  await boss.stop();
  process.exitCode = 1;
}
