import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
const numberString = z
  .union([
    z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    z.string().regex(/^[1-9]\d{0,15}$/),
  ])
  .transform(String);
const telegramSchema = z
  .object({
    id: numberString,
    first_name: z.string().min(1).max(128),
    last_name: z.string().max(128).optional(),
    username: z.string().max(64).optional(),
    photo_url: z.string().max(2048).optional(),
    auth_date: numberString,
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export function verifyTelegram(
  input: unknown,
  botToken: string,
  now: Date,
  maxAgeSeconds = 86400,
) {
  const parsed = telegramSchema.safeParse(input);
  if (!parsed.success || !botToken) return null;
  const { hash, ...data } = parsed.data;
  const age = Math.floor(now.getTime() / 1000) - Number(data.auth_date);
  if (
    !Number.isSafeInteger(Number(data.auth_date)) ||
    age < 0 ||
    age > maxAgeSeconds
  )
    return null;
  const checkString = Object.entries(data)
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return null;
  return {
    telegramId: BigInt(data.id),
    name: data.first_name,
    username: data.username,
    hash,
    expiresAt: new Date((Number(data.auth_date) + maxAgeSeconds) * 1000),
  };
}
