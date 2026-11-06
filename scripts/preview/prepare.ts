import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Client } from "pg";
const folder = "tmp/preview";
await mkdir(folder, { recursive: true });
try {
  await readFile(`${folder}/database.json`);
  console.log("Preview database configuration already exists; kept unchanged.");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const source = new URL(process.env.DATABASE_URL!);
  const suffix = randomBytes(6).toString("hex");
  const database = `dental_preview_${suffix}`;
  const role = `preview_${suffix}`;
  const password = randomBytes(32).toString("hex");
  const admin = new Client({ connectionString: source.toString() });
  await admin.connect();
  try {
    // All interpolated SQL identifiers/literals are generated hex with fixed prefixes.
    await admin.query(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password}'`,
    );
    await admin.query(`CREATE DATABASE "${database}" OWNER "${role}"`);
  } finally {
    await admin.end();
  }
  source.pathname = `/${database}`;
  const extensionAdmin = new Client({ connectionString: source.toString() });
  await extensionAdmin.connect();
  try {
    await extensionAdmin.query("CREATE EXTENSION IF NOT EXISTS vector");
  } finally {
    await extensionAdmin.end();
  }
  source.username = role;
  source.password = password;
  const docker = new URL(source);
  docker.hostname = "postgres";
  await writeFile(
    `${folder}/database.json`,
    JSON.stringify({
      database,
      localURL: source.toString(),
      dockerURL: docker.toString(),
    }),
    { mode: 0o600 },
  );
  console.log(
    "Created a separate preview database and a restricted database role.",
  );
}
