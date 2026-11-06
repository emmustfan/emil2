import type { AppEnv } from "./env";
export class ProviderNotImplementedError extends Error {
  constructor(provider: string) {
    super(`Provider ${provider} is not implemented in stage 0`);
    this.name = "ProviderNotImplementedError";
  }
}
export function assertDevelopment(env: Pick<AppEnv, "NODE_ENV">): void {
  if (env.NODE_ENV === "production")
    throw new Error("Development adapters are forbidden in production");
}
