import { PgBoss } from "pg-boss";
import { getEnv } from "../lib/env";
import { logger } from "../lib/logger";
export const SMOKE_QUEUE = "foundation-smoke";
export function createQueueClient() {
  const boss = new PgBoss({
    connectionString: getEnv().DATABASE_URL,
    application_name: "dental-worker",
  });
  boss.on("error", (error) =>
    logger.error({ error: error.message }, "queue_error"),
  );
  return boss;
}
