import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../lib/env";
const base = { DATABASE_URL: "postgresql://app:app@localhost:5432/app" };
describe("environment", () => {
  it("accepts the complete standard .env.example used by the Mac launcher", () => {
    const template = parse(readFileSync(".env.example"));
    expect(parseEnv(template)).toMatchObject({
      YANDEX_METRIKA_ID: undefined,
      SUPPORT_EMAIL: undefined,
      LLM_PROVIDER: "mock",
    });
  });
  it.each([undefined, ""])(
    "disables Metrika when its optional ID is %s",
    (id) => {
      expect(
        parseEnv({ ...base, YANDEX_METRIKA_ID: id }).YANDEX_METRIKA_ID,
      ).toBeUndefined();
    },
  );
  it("accepts a configured numeric Metrika ID and still rejects invalid nonempty IDs", () => {
    expect(
      parseEnv({ ...base, YANDEX_METRIKA_ID: "12345678" }).YANDEX_METRIKA_ID,
    ).toBe("12345678");
    for (const id of ["abc", "123abc", "-1", "1.5", "1234567890123"])
      expect(() => parseEnv({ ...base, YANDEX_METRIKA_ID: id })).toThrow(
        "YANDEX_METRIKA_ID",
      );
  });

  it("accepts empty commented legacy fiscal settings from Docker but rejects an invalid configured VAT code", () => {
    const parsed = parseEnv({
      ...base,
      RECEIPT_VAT_CODE: "# уточнить у бухгалтера",
      YOOKASSA_WEBHOOK_IPS: "# список IP",
      RECEIPT_TAX_SYSTEM_CODE: "   ",
    });
    expect(parsed.RECEIPT_VAT_CODE).toBeUndefined();
    expect(parsed.YOOKASSA_WEBHOOK_IPS).toBe("");
    expect(() => parseEnv({ ...base, RECEIPT_VAT_CODE: "invalid" })).toThrow(
      "RECEIPT_VAT_CODE",
    );
  });
  it("accepts development defaults with only a database URL", () => {
    expect(parseEnv(base)).toMatchObject({
      LLM_PROVIDER: "mock",
      PAYMENTS_PROVIDER: "mock",
      MAIL_TRANSPORT: "log",
      STORAGE_DRIVER: "local",
    });
  });
  it("reports missing fields without exposing secret values", () => {
    expect(() =>
      parseEnv({
        ...base,
        PAYMENTS_PROVIDER: "yookassa",
        YOOKASSA_SECRET_KEY: "do-not-print-me",
      }),
    ).toThrow("YOOKASSA_SHOP_ID");
    try {
      parseEnv({
        ...base,
        PAYMENTS_PROVIDER: "yookassa",
        YOOKASSA_SECRET_KEY: "do-not-print-me",
      });
    } catch (error) {
      expect(String(error)).not.toContain("do-not-print-me");
    }
  });
  it.each([
    "LLM_PROVIDER",
    "PAYMENTS_PROVIDER",
    "MAIL_TRANSPORT",
    "STORAGE_DRIVER",
  ])("forbids development %s in production", (key) => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(key);
  });
  it("validates database protocol and embedding dimension", () => {
    expect(() => parseEnv({ DATABASE_URL: "file:database.db" })).toThrow(
      "DATABASE_URL",
    );
    expect(() => parseEnv({ ...base, EMBEDDING_DIM: 0 })).toThrow(
      "EMBEDDING_DIM",
    );
  });
  it("requires credentials for real provider selection", () => {
    expect(() =>
      parseEnv({ ...base, LLM_PROVIDER: "openai_compatible" }),
    ).toThrow("LLM_API_KEY");
    expect(() => parseEnv({ ...base, MAIL_TRANSPORT: "smtp" })).toThrow(
      "SMTP_HOST",
    );
    expect(() => parseEnv({ ...base, STORAGE_DRIVER: "s3" })).toThrow(
      "S3_BUCKET",
    );
  });
});
