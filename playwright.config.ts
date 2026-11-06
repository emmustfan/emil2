import "dotenv/config";
import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
// Keep browser binaries inside the writable, ignored project directory.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve("tmp/playwright");
process.env.E2E_RUN_ID ??= randomUUID();
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "corepack pnpm dev --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      APP_URL: "http://localhost:3100",
      LLM_PROVIDER: "mock",
      PAYMENTS_PROVIDER: "mock",
      MAIL_TRANSPORT: "log",
      STORAGE_DRIVER: "local",
      TRUST_PROXY: "true",
      TELEGRAM_BOT_TOKEN: "123456:fixture-only-not-a-real-key",
      TELEGRAM_BOT_USERNAME: "fixture_bot",
      ADMIN_EMAILS: `owner-chromium-${process.env.E2E_RUN_ID}@example.test,owner-mobile-${process.env.E2E_RUN_ID}@example.test`,
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/app",
    },
  },
});
