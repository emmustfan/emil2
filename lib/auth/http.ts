import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getEnv } from "../env";
import { AuthError } from "./errors";
import { authRu } from "../i18n/ru";
export function assertOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(getEnv().APP_URL).origin)
    throw new AuthError("forbidden", 403);
}
export function clientIp(request: Request) {
  // Never trust client-supplied forwarding headers without an explicitly configured proxy.
  const ip = getEnv().TRUST_PROXY ? request.headers.get("x-real-ip") : null;
  return ip && isIP(ip) ? ip : "unknown";
}
export async function readInput(request: Request, maxBytes = 8192) {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes)
    throw new AuthError("invalid");
  const reader = request.body?.getReader();
  let raw = "";
  let bytes = 0;
  if (reader) {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new AuthError("invalid");
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  try {
    return request.headers.get("content-type")?.includes("application/json")
      ? JSON.parse(raw)
      : Object.fromEntries(new URLSearchParams(raw));
  } catch {
    throw new AuthError("invalid");
  }
}
export function authFailure(error: unknown) {
  const known =
    error instanceof AuthError
      ? error
      : typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        ? new AuthError("conflict", 409)
        : error instanceof ZodError
          ? new AuthError("invalid", 422)
          : new AuthError("unavailable", 503);
  if (known.code === "unavailable") console.error("auth_operation_failed");
  return NextResponse.json(
    { error: authRu.errors[known.code] },
    {
      status: known.status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
export function authRedirect(path: string) {
  const response = NextResponse.redirect(new URL(path, getEnv().APP_URL), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
