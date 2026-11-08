import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AppEnv } from "../env";
import { assertDevelopment, ProviderNotImplementedError } from "../providers";
export interface StorageDriver {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export class LocalStorageDriver implements StorageDriver {
  constructor(private readonly directory = "tmp/uploads") {}
  private path(key: string) {
    // Flat opaque keys: callers retain original filenames separately.
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(key))
      throw new Error("Invalid storage key");
    return join(this.directory, key);
  }
  async put(key: string, body: Uint8Array) {
    const file = this.path(key);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(file, body, { mode: 0o600, flag: "wx" });
  }
  async get(key: string) {
    return readFile(this.path(key));
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}
export function createStorageDriver(env: AppEnv): StorageDriver {
  if (env.STORAGE_DRIVER !== "local")
    throw new ProviderNotImplementedError(env.STORAGE_DRIVER);
  assertDevelopment(env);
  return new LocalStorageDriver();
}
