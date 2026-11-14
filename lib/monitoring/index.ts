import { randomUUID, createHash } from "node:crypto";
export type FaultCode =
  | "request_failed"
  | "worker_failed"
  | "queue_failed"
  | "billing_sync_failed"
  | "billing_tick_failed"
  | "billing_mail_failed"
  | "webhook_failed"
  | "import_failed"
  | "privacy_failed"
  | "llm_budget_exceeded"
  | "llm_metering_failed";
export function sentryEndpoint(dsn: string) {
  const url = new URL(dsn),
    segments = url.pathname.split("/").filter(Boolean),
    project = segments.pop();
  if (
    url.protocol !== "https:" ||
    url.password ||
    !url.username ||
    !/^\d+$/.test(project ?? "") ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid monitoring DSN");
  const key = url.username;
  url.username = "";
  url.pathname = `/${segments.length ? segments.join("/") + "/" : ""}api/${project}/envelope/`;
  return { url: url.href, key };
}
export function safeFault(code: FaultCode, error?: unknown) {
  // No original message, request URL, headers, stack, account IDs or content leave the app.
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  const locations = stack
    .split("\n")
    .slice(1, 8)
    .map(
      (line) =>
        line.match(/(?:\/|\\)([a-zA-Z0-9_.-]+\.(?:js|ts|tsx)):\d+:\d+/)?.[1] ??
        "frame",
    );
  return {
    event_id: randomUUID().replaceAll("-", ""),
    timestamp: Date.now() / 1000,
    platform: "node",
    level: code === "llm_budget_exceeded" ? "warning" : "error",
    message: code,
    fingerprint: [
      code,
      createHash("sha256")
        .update(locations.join("|"))
        .digest("hex")
        .slice(0, 16),
    ],
    tags: {
      component:
        code.startsWith("billing") || code === "webhook_failed"
          ? "billing"
          : "application",
    },
  };
}
const lastEvents = new Map<string, number>();
let minute = 0,
  count = 0;
export async function reportFault(code: FaultCode, error?: unknown) {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || process.env.NODE_ENV !== "production") return false;
  const now = Date.now(),
    period = Math.floor(now / 60000);
  if (period !== minute) {
    minute = period;
    count = 0;
  }
  const event = safeFault(code, error),
    key = event.fingerprint.join(":");
  if (count >= 10 || (lastEvents.get(key) ?? 0) > now - 60000) return false;
  count++;
  lastEvents.set(key, now);
  for (const [k, t] of lastEvents) if (t < now - 3600000) lastEvents.delete(k);
  try {
    const endpoint = sentryEndpoint(dsn),
      envelope =
        JSON.stringify({ event_id: event.event_id }) +
        "\n" +
        JSON.stringify({ type: "event" }) +
        "\n" +
        JSON.stringify(event);
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7,sentry_client=emil2-native/1.0,sentry_key=${endpoint.key}`,
      },
      body: envelope,
      signal: AbortSignal.timeout(2000),
      redirect: "error",
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
