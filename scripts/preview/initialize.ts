import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const config = JSON.parse(
  await readFile("tmp/preview/database.json", "utf8"),
) as { localURL: string };
const name = new URL(config.localURL).pathname.slice(1);
if (!/^dental_preview_[a-f0-9]{12}$/.test(name))
  throw new Error("Not a preview database");
const env = {
  ...process.env,
  DATABASE_URL: config.localURL,
  LLM_PROVIDER: "mock",
  PAYMENTS_PROVIDER: "mock",
  MAIL_TRANSPORT: "log",
  STORAGE_DRIVER: "local",
};
for (const command of [
  ["pnpm", "db:migrate"],
  ["pnpm", "db:seed"],
  ["pnpm", "exec", "tsx", "scripts/preview/seed.ts"],
]) {
  const result = spawnSync("corepack", command, { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
