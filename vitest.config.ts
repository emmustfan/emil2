import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    env: {
      NODE_ENV: "test",
      LLM_PROVIDER: "mock",
      PAYMENTS_PROVIDER: "mock",
      MAIL_TRANSPORT: "log",
      STORAGE_DRIVER: "local",
    },
  },
});
