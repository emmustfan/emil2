import type { Prisma } from "../generated/prisma/client";
import { createQueueClient } from "../../worker/queue";
export const CONTENT_IMPORT_QUEUE = "content-import";
export const IMPORT_TICK = "content-import-tick";
export const CONTENT_INDEX_QUEUE = "content-index";
let queuePromise: Promise<ReturnType<typeof createQueueClient>> | null = null;
export function getContentQueue() {
  queuePromise ??= (async () => {
    const queue = createQueueClient();
    try {
      await queue.start();
      await queue.createQueue(CONTENT_INDEX_QUEUE);
      await queue.createQueue(CONTENT_IMPORT_QUEUE);
      return queue;
    } catch (error) {
      await queue.stop();
      queuePromise = null;
      throw error;
    }
  })();
  return queuePromise;
}
export async function enqueuePublication(
  tx: Prisma.TransactionClient,
  topic: { id: string; subjectId: string; version: number },
) {
  const queue = await getContentQueue();
  const id = await queue.send(
    CONTENT_INDEX_QUEUE,
    { topicId: topic.id, subjectId: topic.subjectId, version: topic.version },
    {
      retryLimit: 3,
      retryDelay: 5,
      retryBackoff: true,
      db: {
        executeSql: async (text, values) => ({
          rows: await tx.$queryRawUnsafe<unknown[]>(text, ...(values ?? [])),
        }),
      },
    },
  );
  if (!id) throw new Error("Content indexing job was not enqueued");
}
export async function closeContentQueue() {
  if (queuePromise) {
    const queue = await queuePromise;
    await queue.stop({ graceful: true, timeout: 5000 });
    queuePromise = null;
  }
}
