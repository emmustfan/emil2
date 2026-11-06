import { setTimeout } from "node:timers/promises";
import { createQueueClient, SMOKE_QUEUE } from "./queue";
const boss = createQueueClient();
try {
  await boss.start();
  await boss.createQueue(SMOKE_QUEUE);
  const id = await boss.send(SMOKE_QUEUE, { source: "smoke" });
  if (!id) throw new Error("Smoke job was not queued");
  const deadline = Date.now() + 30000;
  let completed = false;
  while (Date.now() < deadline) {
    const job = await boss.getJobById(SMOKE_QUEUE, id);
    if (job?.state === "completed") {
      completed = true;
      break;
    }
    if (job?.state === "failed") throw new Error("Smoke job failed");
    await setTimeout(250);
  }
  if (!completed)
    throw new Error("Smoke job timed out; start pnpm worker first");
  console.info(`Worker smoke passed: ${id}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Worker smoke failed");
  process.exitCode = 1;
} finally {
  await boss.stop({ graceful: true, timeout: 5000 });
}
