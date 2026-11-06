import { unstable_cache } from "next/cache";
import { getDb } from "../db";
import { decodeSetting, type SettingKey } from "./defaults";
const readSettings = unstable_cache(
  async () => getDb().appSetting.findMany(),
  ["app-settings-v1"],
  { revalidate: 60, tags: ["app-settings"] },
);
export async function getSetting<K extends SettingKey>(key: K) {
  return decodeSetting(
    key,
    (await readSettings()).find((row) => row.key === key)?.value,
  );
}
