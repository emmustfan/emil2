import { z } from "zod";
export const ANON_COOKIE = "anon_id";
export const TOUCH_COOKIE = "first_touch";
export const DEMO_COOKIE = "demo_sid";
const value = z
  .string()
  .max(120)
  .regex(/^[\p{L}\p{N} _.,:~+\/-]*$/u);
export const touchSchema = z
  .object({
    utm_source: value.optional(),
    utm_medium: value.optional(),
    utm_campaign: value.optional(),
    utm_term: value.optional(),
    utm_content: value.optional(),
    referrer: z
      .string()
      .max(253)
      .regex(/^[a-z0-9.-]*$/)
      .optional(),
  })
  .strict();
export function firstTouch(url: URL, referer: string | null) {
  const data: Record<string, string> = {};
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
  ]) {
    const parsed = value.safeParse(url.searchParams.get(key));
    if (parsed.success && parsed.data) data[key] = parsed.data;
  }
  try {
    const source = new URL(referer ?? "");
    if (
      ["http:", "https:"].includes(source.protocol) &&
      source.origin !== url.origin
    )
      data.referrer = source.hostname;
  } catch {
    /* No external referrer. */
  }
  return touchSchema.parse(data);
}
export function readTouch(raw?: string) {
  try {
    return touchSchema.parse(JSON.parse(raw ?? "{}"));
  } catch {
    return {};
  }
}
