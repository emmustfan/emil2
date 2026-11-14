import { getDb } from "../db";
export function workerIsReady(value: unknown, now = Date.now()) {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  return (
    Number.isFinite(timestamp) &&
    timestamp <= now + 30000 &&
    timestamp > now - 180000
  );
}
export async function heartbeat() {
  await getDb().appSetting.upsert({
    where: { key: "ops.workerHeartbeat" },
    create: { key: "ops.workerHeartbeat", value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });
}
