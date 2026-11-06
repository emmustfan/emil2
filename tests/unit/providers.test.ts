import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "../../lib/env";
import { createLLMProvider } from "../../lib/llm";
import { createPaymentsProvider } from "../../lib/payments";
import { createMailTransport, LogMailTransport } from "../../lib/mail";
import { createStorageDriver, LocalStorageDriver } from "../../lib/storage";
const env = parseEnv({
  DATABASE_URL: "postgresql://app:app@localhost/app",
  EMBEDDING_DIM: 8,
});
const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "dental-unit-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
describe("development adapters", () => {
  it("provides deterministic normalized embeddings of configured size", async () => {
    const provider = createLLMProvider(env);
    const [a, b, c] = await provider.embed(["one", "one", "two"]);
    expect(a).toHaveLength(8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(Math.hypot(...a)).toBeCloseTo(1);
  });
  it("streams the same mock response as complete without HTTP", async () => {
    const provider = createLLMProvider(env);
    const options = { model: "mock" };
    const result = await provider.complete([], options);
    let streamed = "";
    for await (const chunk of provider.chat([], options)) streamed += chunk;
    expect(streamed).toBe(result.text);
    expect(result.text.length).toBeGreaterThan(0);
  });
  it("keeps mock payment requests idempotent and does not expose mutable internal state", async () => {
    const provider = createPaymentsProvider(env);
    const first = await provider.createPayment(100, "request-1");
    expect(await provider.createPayment(100, "request-1")).toEqual(first);
    await expect(provider.createPayment(200, "request-1")).rejects.toThrow(
      "mismatch",
    );
    first.status = "SUCCEEDED";
    expect((await provider.getPayment(first.id)).status).toBe("PENDING");
    await expect(provider.createPayment(-1, "invalid")).rejects.toThrow();
    await expect(provider.getPayment("absent")).rejects.toThrow("not found");
  });
  it("writes development mail for later e2e use with restrictive permissions", async () => {
    const root = await directory();
    const mail = new LogMailTransport(root);
    const message = {
      to: "student@example.ru",
      subject: "Вход",
      text: "Тестовое письмо",
    };
    const id = await mail.send(message);
    const path = join(root, `${id}.json`);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(message);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
  it("stores and reads binary content without allowing traversal or overwrite", async () => {
    const root = await directory();
    const storage = new LocalStorageDriver(root);
    const bytes = Buffer.from([0, 255, 17]);
    await storage.put("document-1", bytes);
    expect(await storage.get("document-1")).toEqual(bytes);
    for (const key of ["../outside", "/tmp/outside", "a/b", "", "..", "a\\b"])
      await expect(storage.get(key)).rejects.toThrow("Invalid storage key");
    await expect(storage.put("document-1", bytes)).rejects.toThrow();
  });
  it("guards every mock factory even if supplied config bypasses parseEnv", () => {
    for (const factory of [
      createLLMProvider,
      createPaymentsProvider,
      createMailTransport,
      createStorageDriver,
    ])
      expect(() => factory({ ...env, NODE_ENV: "production" })).toThrow(
        "forbidden",
      );
  });
  it("fails explicitly instead of silently using mocks for unimplemented real adapters", () => {
    expect(() =>
      createLLMProvider({ ...env, LLM_PROVIDER: "anthropic" }),
    ).toThrow("not implemented");
    expect(() =>
      createPaymentsProvider({ ...env, PAYMENTS_PROVIDER: "yookassa" }),
    ).toThrow("not implemented");
    expect(() => createStorageDriver({ ...env, STORAGE_DRIVER: "s3" })).toThrow(
      "not implemented",
    );
  });
});
