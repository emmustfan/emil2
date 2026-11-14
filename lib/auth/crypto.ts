import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function isToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}
export function matchesToken(token: string, expected: string): boolean {
  if (!isToken(token) || !/^[0-9a-f]{64}$/.test(expected)) return false;
  return timingSafeEqual(
    Buffer.from(hashToken(token), "hex"),
    Buffer.from(expected, "hex"),
  );
}
