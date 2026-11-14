import { expect, it, afterEach, vi } from "vitest";
import { canIndex, robotsFor } from "../../lib/ops/seo";
import { sentryEndpoint, safeFault, reportFault } from "../../lib/monitoring";
import { estimateCost } from "../../lib/monitoring/usage";
import { workerIsReady } from "../../lib/monitoring/health";
import {
  copyVersionedFiles,
  offsiteConfig,
  restoreFiles,
  pruneBackups,
} from "../../scripts/ops/offsite";
import {
  S3Client,
  GetBucketVersioningCommand,
  ListObjectVersionsCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("keeps previews closed to crawlers and opens only explicit production indexing", () => {
  expect(canIndex({ NODE_ENV: "test", SITE_INDEXING: "true" })).toBe(false);
  expect(canIndex({ NODE_ENV: "production" })).toBe(false);
  expect(canIndex({ NODE_ENV: "production", SITE_INDEXING: "true" })).toBe(
    true,
  );
  expect(robotsFor("https://learn.example.test", true).rules).toMatchObject({
    disallow: expect.arrayContaining([
      "/api",
      "/admin",
      "/teacher",
      "/cabinet",
      "/checkout",
      "/review",
      "/tutor",
    ]),
  });
  expect(
    robotsFor("https://learn.example.test", false).sitemap,
  ).toBeUndefined();
});
it("builds Sentry and GlitchTip endpoints without forwarding DSN credentials to the URL", () => {
  expect(
    sentryEndpoint("https://publickey@errors.example.test/prefix/42"),
  ).toEqual({
    url: "https://errors.example.test/prefix/api/42/envelope/",
    key: "publickey",
  });
  for (const dsn of [
    "http://key@host/1",
    "https://key:secret@host/1",
    "https://host/1",
    "https://key@host/1?token=secret",
  ])
    expect(() => sentryEndpoint(dsn)).toThrow();
});
it("never serializes error messages, tokens, email, account IDs, request data or stack", () => {
  const error = new Error(
    "user@example.test /auth/verify?token=secret account=private-id",
  );
  error.stack += "\n at send (/private/users/name/file.ts:20:3)";
  const payload = JSON.stringify(safeFault("webhook_failed", error));
  for (const secret of [
    "user@example.test",
    "secret",
    "private-id",
    "/private/users",
    "name",
    "stack",
  ])
    expect(payload).not.toContain(secret);
  expect(payload).toContain("webhook_failed");
});
it("never calls external monitoring in tests even if a DSN is set", async () => {
  vi.stubEnv("SENTRY_DSN", "https://fixture@errors.example.test/12");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await reportFault("request_failed", new Error("private"))).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
it("sends bounded native Sentry envelopes and deduplicates failures without a real call", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SENTRY_DSN", "https://fixture@errors.example.test/12");
  const fetch = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const failure = new Error("secret");
  expect(await reportFault("privacy_failed", failure)).toBe(true);
  expect(await reportFault("privacy_failed", failure)).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].body).not.toContain("secret");
  expect(fetch.mock.calls[0][0]).not.toContain("fixture@");
});
it("estimates declared token rates and keeps missing usage or tariffs unknown", () => {
  expect(
    estimateCost("import", 1000000, 1000000, {
      input: 100,
      output: 500,
      embedding: 10,
    }),
  ).toBe(600);
  expect(
    estimateCost("embedding", 1000000, 0, {
      input: 100,
      output: 500,
      embedding: 10,
    }),
  ).toBe(10);
  expect(
    estimateCost("tutor", null, null, {
      input: 100,
      output: 500,
      embedding: 10,
    }),
  ).toBeNull();
  expect(
    estimateCost("tutor", 100, 200, { input: 0, output: 0, embedding: 0 }),
  ).toBeNull();
  expect(
    estimateCost("import", -1, 200, { input: 1, output: 1, embedding: 1 }),
  ).toBeNull();
});
it("marks stalled worker heartbeats unhealthy and rejects invalid/future values", () => {
  const now = Date.now();
  expect(workerIsReady(new Date(now - 30000).toISOString(), now)).toBe(true);
  for (const value of [
    null,
    "bad",
    new Date(now - 180001).toISOString(),
    new Date(now + 60000).toISOString(),
  ])
    expect(workerIsReady(value, now)).toBe(false);
});
it("requires a separate HTTPS backup bucket and copies deleted-but-versioned immutable files", async () => {
  expect(() => offsiteConfig({})).toThrow("BACKUP_S3_ENDPOINT");
  expect(() =>
    offsiteConfig({
      BACKUP_S3_ENDPOINT: "https://backup.example.test",
      BACKUP_S3_REGION: "test",
      BACKUP_S3_BUCKET: "same",
      BACKUP_S3_ACCESS_KEY: "fixture",
      BACKUP_S3_SECRET_KEY: "fixture",
      S3_BUCKET: "same",
    }),
  ).toThrow("differ");
  const source = new S3Client({ region: "test" }),
    backup = new S3Client({ region: "test" });
  vi.spyOn(source, "send").mockImplementation(async (command: unknown) =>
    command instanceof GetBucketVersioningCommand
      ? { Status: "Enabled" }
      : command instanceof ListObjectVersionsCommand
        ? {
            Versions: [{ Key: "image-opaque", VersionId: "v1" }],
            DeleteMarkers: [
              { Key: "image-opaque", VersionId: "deleted-later" },
            ],
            IsTruncated: false,
          }
        : {},
  );
  const send = vi.spyOn(backup, "send").mockImplementation(async () => ({}));
  expect(
    await copyVersionedFiles(source, backup, "source", "backup", "emil2/job"),
  ).toEqual([
    {
      key: "image-opaque",
      versionId: "v1",
      backupKey: "emil2/job/objects/image-opaque",
    },
  ]);
  expect(send.mock.calls[0][0]).toBeInstanceOf(CopyObjectCommand);
  expect(send.mock.calls[0][0].input).toMatchObject({
    CopySource: "source/image-opaque?versionId=v1",
    Bucket: "backup",
  });
  source.destroy();
  backup.destroy();
});

it("refuses restoration into a current or nonempty storage bucket", async () => {
  const client = new S3Client({ region: "test" }),
    send = vi.spyOn(client, "send").mockImplementation(async () => ({
      KeyCount: 1,
      Contents: [{ Key: "existing-image" }],
    }));
  const manifest = {
    format: "emil2-offsite-v1",
    id: "emil2-20261108T120000Z-fixture",
    objects: [
      {
        key: "image-opaque",
        backupKey: "emil2/emil2-20261108T120000Z-fixture/objects/image-opaque",
      },
    ],
  };
  await expect(
    restoreFiles(client, "current", "backups", "current", manifest),
  ).rejects.toThrow("separate");
  expect(send).not.toHaveBeenCalled();
  await expect(
    restoreFiles(client, "new-bucket", "backups", "current", manifest),
  ).rejects.toThrow("empty");
  expect(send).toHaveBeenCalledTimes(1);
  client.destroy();
});
it("prunes only expired completed offsite copies and never follows symlinks", async () => {
  const fs = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    root = await fs.mkdtemp(join(tmpdir(), "emil2-retention-"));
  const old = "emil2-20260901T000000Z-complete",
    incomplete = "emil2-20260901T000000Z-local",
    fresh = "emil2-20261108T000000Z-fresh";
  try {
    for (const name of [old, incomplete, fresh]) {
      await fs.mkdir(join(root, name));
      await fs.writeFile(join(root, name, "FORMAT"), "emil2-backup-v1");
    }
    for (const name of [old, fresh])
      await fs.writeFile(
        join(root, name, "OFFSITE_COMPLETE.json"),
        JSON.stringify({ format: "emil2-offsite-v1", id: name }),
      );
    await fs.symlink(
      join(root, incomplete),
      join(root, "emil2-20260901T000000Z-link"),
    );
    await pruneBackups(root, Date.parse("2026-11-08T12:00:00Z"));
    await expect(fs.stat(join(root, old))).rejects.toThrow();
    expect((await fs.stat(join(root, incomplete))).isDirectory()).toBe(true);
    expect((await fs.stat(join(root, fresh))).isDirectory()).toBe(true);
    expect(
      (
        await fs.lstat(join(root, "emil2-20260901T000000Z-link"))
      ).isSymbolicLink(),
    ).toBe(true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
