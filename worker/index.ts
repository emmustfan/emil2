import { createQueueClient, SMOKE_QUEUE } from "./queue";
import { logger } from "../lib/logger";
const boss = createQueueClient();
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await boss.stop({ graceful: true, timeout: 10000 });
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
