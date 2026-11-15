import { AsyncLocalStorage } from "node:async_hooks";
import { unstable_cache } from "next/cache.js";
import { getDb } from "../db";
import { decodeSetting, type SettingKey } from "./defaults";
const readSettings = unstable_cache(
  async () => getDb().appSetting.findMany(),
  ["app-settings-v1"],
  { revalidate: 60, tags: ["app-settings"] },
);
const settingsSnapshot = new AsyncLocalStorage<Map<string, unknown>>();
/** Run real domain services in CLI jobs against one database-backed configuration snapshot. */
export async function withSettingsSnapshot<T>(
  action: () => Promise<T>,
): Promise<T> {
  const rows = await getDb().appSetting.findMany();
  return settingsSnapshot.run(
    new Map(rows.map((row) => [row.key, row.value])),
    action,
  );
}
export async function getSetting<K extends SettingKey>(key: K) {
  const snapshot = settingsSnapshot.getStore();
  if (snapshot) return decodeSetting(key, snapshot.get(key));
  return decodeSetting(
    key,
    (await readSettings()).find((row) => row.key === key)?.value,
  );
}
