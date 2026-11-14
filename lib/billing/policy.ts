import { BlockList, isIP } from "node:net";
export function amountString(kopecks: number) {
  if (!Number.isSafeInteger(kopecks) || kopecks <= 0)
    throw new Error("Invalid payment amount");
  return `${Math.floor(kopecks / 100)}.${String(kopecks % 100).padStart(2, "0")}`;
}
export function parseAmount(value: string) {
  if (!/^\d{1,9}\.\d{2}$/.test(value))
    throw new Error("Invalid provider amount");
  return Number(value.replace(".", ""));
}
export function addMonths(date: Date, months: number) {
  if (!Number.isInteger(months) || months < 1 || months > 120)
    throw new Error("Invalid period");
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next;
}
export function scopeKey(
  userId: string,
  kind: string,
  subjectId: string | null,
) {
  return `${userId}:${kind}:${subjectId ?? "all"}`;
}
export function nextRetry(first: Date, failures: number, hours: number[]) {
  return failures <= hours.length
    ? new Date(first.getTime() + hours[failures - 1] * 3600000)
    : null;
}
export function chargeAt(end: Date, leadHours: number) {
  return new Date(end.getTime() - leadHours * 3600000);
}
export function allowedWebhookIp(ip: string, ranges: string) {
  const list = new BlockList();
  try {
    for (const item of ranges
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const [address, mask, extra] = item.split("/");
      const family = isIP(address);
      if (!family || extra !== undefined) return false;
      if (mask === undefined)
        list.addAddress(address, family === 4 ? "ipv4" : "ipv6");
      else {
        if (!/^\d+$/.test(mask) || Number(mask) > (family === 4 ? 32 : 128))
          return false;
        list.addSubnet(address, Number(mask), family === 4 ? "ipv4" : "ipv6");
      }
    }
    if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
    return !!isIP(ip) && list.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}
export function safePricingReturn(value?: string | null) {
  if (!value || !value.startsWith("/pricing") || value.startsWith("//"))
    return "/cabinet";
  try {
    const url = new URL(value, "https://local.invalid");
    return url.origin === "https://local.invalid" && url.pathname === "/pricing"
      ? url.pathname + url.search
      : "/cabinet";
  } catch {
    return "/cabinet";
  }
}
