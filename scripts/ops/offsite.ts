import "dotenv/config";
import { createReadStream } from "node:fs";
import { readFile, writeFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetBucketVersioningCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
export function offsiteConfig(
  env: Record<string, string | undefined> = process.env,
) {
  for (const key of [
    "BACKUP_S3_ENDPOINT",
    "BACKUP_S3_REGION",
    "BACKUP_S3_BUCKET",
    "BACKUP_S3_ACCESS_KEY",
    "BACKUP_S3_SECRET_KEY",
  ])
    if (!env[key])
      throw new Error(`Set ${key} for a separate private backup bucket`);
  if (env.BACKUP_S3_BUCKET === env.S3_BUCKET)
    throw new Error("Backup and application buckets must differ");
  const endpoint = new URL(env.BACKUP_S3_ENDPOINT!);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
    throw new Error("Backup storage requires HTTPS");
  if (
    env.STORAGE_DRIVER === "s3" &&
    (env.BACKUP_S3_ENDPOINT?.replace(/\/$/, "") !==
      env.S3_ENDPOINT?.replace(/\/$/, "") ||
      env.BACKUP_S3_REGION !== env.S3_REGION)
  )
    throw new Error(
      "Use the same provider/region for versioned server-side copies",
    );
  return env;
}
const objectName = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
export async function copyVersionedFiles(
  source: S3Client,
  backup: S3Client,
  bucket: string,
  destination: string,
  prefix: string,
) {
  if (
    (await source.send(new GetBucketVersioningCommand({ Bucket: bucket })))
      .Status !== "Enabled"
  )
    throw new Error(
      "Enable versioning on the application bucket before production backups",
    );
  const objects = new Map<string, string>();
  let keyMarker: string | undefined,
    versionMarker: string | undefined,
    pages = 0;
  do {
    const page = await source.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        KeyMarker: keyMarker,
        VersionIdMarker: versionMarker,
      }),
    );
    for (const object of page.Versions ?? []) {
      if (!object.Key || !object.VersionId || !objectName.test(object.Key))
        throw new Error(
          "Application bucket must contain only opaque platform keys",
        );
      // Keys are immutable. Keep non-current bodies too, including files deleted after pg_dump.
      if (
        objects.has(object.Key) &&
        objects.get(object.Key) !== object.VersionId
      )
        throw new Error(
          "Application object was overwritten; review version history before backup",
        );
      objects.set(object.Key, object.VersionId);
    }
    if (++pages > 1000 || objects.size > 100000)
      throw new Error("Backup requires batching beyond MVP limits");
    if (!page.IsTruncated) break;
    if (!page.NextKeyMarker)
      throw new Error("Storage returned an invalid version cursor");
    keyMarker = page.NextKeyMarker;
    versionMarker = page.NextVersionIdMarker;
  } while (true);
  const manifest = [];
  for (const [key, versionId] of objects) {
    const target = `${prefix}/objects/${key}`;
    await backup.send(
      new CopyObjectCommand({
        Bucket: destination,
        Key: target,
        CopySource: `${bucket}/${encodeURIComponent(key)}?versionId=${encodeURIComponent(versionId)}`,
      }),
    );
    manifest.push({ key, versionId, backupKey: target });
  }
  return manifest;
}
export async function restoreFiles(
  client: S3Client,
  target: string,
  backupBucket: string,
  sourceBucket: string,
  manifest: {
    format: string;
    id: string;
    objects: { key: string; backupKey: string }[];
  },
) {
  if (!target || target === backupBucket || target === sourceBucket)
    throw new Error("Restore requires a separate empty destination bucket");
  if (
    manifest.format !== "emil2-offsite-v1" ||
    !/^emil2-\d{8}T\d{6}Z-[A-Za-z0-9]+$/.test(manifest.id) ||
    manifest.objects.length > 100000
  )
    throw new Error("Invalid backup manifest");
  const contents = await client.send(
    new ListObjectsV2Command({ Bucket: target, MaxKeys: 1 }),
  );
  if ((contents.KeyCount ?? 0) > 0 || contents.Contents?.length)
    throw new Error(
      "Restore bucket must be empty; existing files were not changed",
    );
  for (const object of manifest.objects) {
    if (
      !objectName.test(object.key) ||
      object.backupKey !== `emil2/${manifest.id}/objects/${object.key}`
    )
      throw new Error("Invalid backup object path");
  }
  for (const object of manifest.objects)
    await client.send(
      new CopyObjectCommand({
        Bucket: target,
        Key: object.key,
        CopySource: `${backupBucket}/${object.backupKey}`,
      }),
    );
}
export async function uploadBackup(folder: string) {
  const env = offsiteConfig(),
    id = basename(folder);
  if (!/^emil2-\d{8}T\d{6}Z-[A-Za-z0-9]+$/.test(id))
    throw new Error("Invalid backup directory");
  const backup = new S3Client({
      endpoint: env.BACKUP_S3_ENDPOINT,
      region: env.BACKUP_S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.BACKUP_S3_ACCESS_KEY!,
        secretAccessKey: env.BACKUP_S3_SECRET_KEY!,
      },
      maxAttempts: 2,
    }),
    bucket = env.BACKUP_S3_BUCKET!,
    prefix = `emil2/${id}`;
  // Both buckets must be on the same provider/account for server-side version copying.
  const objects =
    env.STORAGE_DRIVER === "s3"
      ? await copyVersionedFiles(
          new S3Client({
            endpoint: env.S3_ENDPOINT,
            region: env.S3_REGION,
            forcePathStyle: true,
            credentials: {
              accessKeyId: env.S3_ACCESS_KEY!,
              secretAccessKey: env.S3_SECRET_KEY!,
            },
            maxAttempts: 2,
          }),
          backup,
          env.S3_BUCKET!,
          bucket,
          prefix,
        )
      : [];
  const metadata = {
    format: "emil2-offsite-v1",
    id,
    completedAt: new Date().toISOString(),
    objects,
  };
  await writeFile(join(folder, "objects.json"), JSON.stringify(metadata), {
    mode: 0o600,
  });
  const checksums: Record<string, string> = {};
  for (const name of [
    "database.dump",
    "uploads.tar",
    "FORMAT",
    "SHA256SUMS",
    "objects.json",
  ]) {
    const path = join(folder, name),
      info = await stat(path);
    if (!info.isFile() || info.size > 4 * 1024 ** 3)
      throw new Error("Backup archive requires multipart upload");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    checksums[name] = hash.digest("hex");
    await backup.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${prefix}/${name}`,
        Body: createReadStream(path),
        ContentLength: info.size,
        ContentType: "application/octet-stream",
        IfNoneMatch: "*",
      }),
    );
  }
  // Completion marker is written last. Incomplete prefixes are never restore points.
  const completed = JSON.stringify({ ...metadata, checksums });
  await backup.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${prefix}/COMPLETE.json`,
      Body: completed,
      ContentType: "application/json",
      IfNoneMatch: "*",
    }),
  );
  await writeFile(join(folder, "OFFSITE_COMPLETE.json"), completed, {
    mode: 0o600,
  });
  console.log(
    "Offsite backup completed; no source contents or credentials printed.",
  );
  backup.destroy();
}
export async function pruneBackups(folder: string, now = Date.now()) {
  const { readdir, rm } = await import("node:fs/promises");
  for (const name of await readdir(folder)) {
    const match = name.match(
      /^emil2-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[A-Za-z0-9]+$/,
    );
    if (!match) continue;
    const created = Date.UTC(
      ...([
        Number(match[1]),
        Number(match[2]) - 1,
        ...match.slice(3).map(Number),
      ] as [number, number, number, number, number, number]),
    );
    const path = join(folder, name),
      info = await import("node:fs/promises").then((m) => m.lstat(path));
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      created > now - 14 * 86400000
    )
      continue;
    try {
      if (
        (await readFile(join(path, "FORMAT"), "utf8")).trim() !==
        "emil2-backup-v1"
      )
        continue;
      const completed = JSON.parse(
        await readFile(join(path, "OFFSITE_COMPLETE.json"), "utf8"),
      );
      if (completed.id !== name || completed.format !== "emil2-offsite-v1")
        continue;
      await rm(path, { recursive: true });
    } catch {
      continue;
    }
  }
}
// No network on import by tests. Operator commands only.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve("scripts/ops/offsite.ts")
) {
  if (process.argv[2] === "upload") await uploadBackup(process.argv[3]);
  else if (process.argv[2] === "prune-local")
    await pruneBackups(process.argv[3]);
  else if (process.argv[2] === "restore-files") {
    const env = offsiteConfig(),
      folder = process.argv[3],
      completed = JSON.parse(
        await readFile(join(folder, "OFFSITE_COMPLETE.json"), "utf8"),
      ),
      raw = await readFile(join(folder, "objects.json"));
    if (
      createHash("sha256").update(raw).digest("hex") !==
      completed.checksums["objects.json"]
    )
      throw new Error("Backup manifest checksum mismatch");
    const target = env.RESTORE_S3_BUCKET;
    if (!target || !env.RESTORE_S3_ACCESS_KEY || !env.RESTORE_S3_SECRET_KEY)
      throw new Error(
        "Set RESTORE_S3_BUCKET and dedicated restore credentials",
      );
    const client = new S3Client({
      endpoint: env.BACKUP_S3_ENDPOINT,
      region: env.BACKUP_S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.RESTORE_S3_ACCESS_KEY,
        secretAccessKey: env.RESTORE_S3_SECRET_KEY,
      },
      maxAttempts: 2,
    });
    try {
      await restoreFiles(
        client,
        target,
        env.BACKUP_S3_BUCKET!,
        env.S3_BUCKET ?? "",
        JSON.parse(raw.toString()),
      );
    } finally {
      client.destroy();
    }
    console.log(
      "Files copied into a separate restore bucket; current application bucket unchanged.",
    );
  } else
    throw new Error(
      "Usage: offsite.ts upload|prune-local|restore-files DIRECTORY",
    );
}
