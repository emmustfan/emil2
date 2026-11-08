import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import type { AppEnv } from "../env";
import type { StorageDriver } from "./index";
export class S3StorageDriver implements StorageDriver {
  private client: S3Client;
  constructor(private readonly env: AppEnv) {
    const endpoint = new URL(env.S3_ENDPOINT!);
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.protocol !== "https:"
    )
      throw new Error(
        "S3 requires an HTTPS endpoint without credentials in its URL",
      );
    this.client = new S3Client({
      endpoint: endpoint.href,
      region: env.S3_REGION!,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY!,
        secretAccessKey: env.S3_SECRET_KEY!,
      },
      maxAttempts: 2,
      requestHandler: { requestTimeout: 30000, connectionTimeout: 5000 },
    });
  }
  private key(key: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(key))
      throw new Error("Invalid storage key");
    return { Bucket: this.env.S3_BUCKET!, Key: key };
  }
  async put(key: string, body: Uint8Array) {
    await this.client.send(
      new PutObjectCommand({
        ...this.key(key),
        Body: body,
        ContentType: "application/octet-stream",
        IfNoneMatch: "*",
      }),
    );
  }
  async get(key: string) {
    const result = await this.client.send(new GetObjectCommand(this.key(key)));
    if (!result.Body) throw new Error("Storage returned no body");
    if ((result.ContentLength ?? 0) > 20971520) {
      (result.Body as Readable).destroy();
      throw new Error("Storage object too large");
    }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      length += chunk.byteLength;
      if (length > 20971520) {
        (result.Body as Readable).destroy();
        throw new Error("Storage object too large");
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand(this.key(key)));
  }
}
