import { z } from "zod";
// Compose may retain a comment after an empty assignment from an older .env.
const optionalValue = (value: unknown) =>
  typeof value === "string" && (!value.trim() || value.trim().startsWith("#"))
    ? undefined
    : value;
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    YANDEX_METRIKA_ID: z.preprocess(
      optionalValue,
      z
        .string()
        .regex(/^\d{1,12}$/)
        .optional(),
    ),
    SUPPORT_EMAIL: z.preprocess(optionalValue, z.email().optional()),
    ADMIN_EMAILS: z.string().default(""),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_BOT_USERNAME: z.string().optional(),
    TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, "Expected PostgreSQL connection URL"),
    LLM_PROVIDER: z
      .enum(["mock", "openai_compatible", "anthropic"])
      .default("mock"),
    PAYMENTS_PROVIDER: z.enum(["mock", "yookassa"]).default("mock"),
    MAIL_TRANSPORT: z.enum(["log", "smtp"]).default("log"),
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    EMBEDDING_DIM: z.coerce.number().int().min(1).max(8192).default(1536),
    LLM_API_KEY: z.string().optional(),
    LLM_BASE_URL: z.string().optional(),
    LLM_CHAT_MODEL: z.string().optional(),
    LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
    LLM_EMBEDDING_MODEL: z.string().optional(),
    LLM_EMBEDDING_BASE_URL: z.string().optional(),
    LLM_EMBEDDING_API_KEY: z.string().optional(),
    YOOKASSA_WEBHOOK_IPS: z.preprocess(optionalValue, z.string().default("")),
    YOOKASSA_TEST_MODE: z.preprocess(
      (v) => (typeof v === "boolean" ? String(v) : optionalValue(v)),
      z
        .enum(["true", "false"])
        .default("true")
        .transform((v) => v === "true"),
    ),
    RECEIPT_VAT_CODE: z.preprocess(
      optionalValue,
      z.coerce.number().int().min(1).max(12).optional(),
    ),
    RECEIPT_TAX_SYSTEM_CODE: z.preprocess(
      optionalValue,
      z.coerce.number().int().min(1).max(6).optional(),
    ),
    YOOKASSA_SHOP_ID: z.string().optional(),
    YOOKASSA_SECRET_KEY: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default("Учебная платформа <no-reply@example.ru>"),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const requireFields = (keys: (keyof typeof env)[]) => {
      for (const key of keys)
        if (!env[key])
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Required for the selected provider",
          });
    };
    if (env.NODE_ENV === "production" && !env.APP_URL.startsWith("https://"))
      ctx.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "HTTPS is required in production",
      });
    if (env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_USERNAME)
      requireFields(["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME"]);
    if (env.LLM_PROVIDER !== "mock")
      requireFields(["LLM_API_KEY", "LLM_CHAT_MODEL", "LLM_EMBEDDING_MODEL"]);
    if (env.LLM_PROVIDER === "openai_compatible")
      requireFields(["LLM_BASE_URL"]);
    if (env.LLM_PROVIDER === "anthropic")
      requireFields(["LLM_EMBEDDING_BASE_URL", "LLM_EMBEDDING_API_KEY"]);
    if (env.PAYMENTS_PROVIDER === "yookassa")
      requireFields([
        "YOOKASSA_SHOP_ID",
        "YOOKASSA_SECRET_KEY",
        "YOOKASSA_WEBHOOK_IPS",
        "RECEIPT_VAT_CODE",
      ]);
    if (env.MAIL_TRANSPORT === "smtp") requireFields(["SMTP_HOST"]);
    if (env.STORAGE_DRIVER === "s3")
      requireFields([
        "S3_ENDPOINT",
        "S3_REGION",
        "S3_BUCKET",
        "S3_ACCESS_KEY",
        "S3_SECRET_KEY",
      ]);
    if (env.NODE_ENV === "production")
      for (const key of [
        "LLM_PROVIDER",
        "PAYMENTS_PROVIDER",
        "MAIL_TRANSPORT",
        "STORAGE_DRIVER",
      ] as const) {
        if (["mock", "log", "local"].includes(env[key]))
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Development adapter is forbidden in production",
          });
      }
  });
export type AppEnv = z.infer<typeof envSchema>;
export function parseEnv(input: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      `Invalid environment: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  return result.data;
}
export function getEnv(): AppEnv {
  return parseEnv(process.env);
}
