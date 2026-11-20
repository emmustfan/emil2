// Apply the stage 15 migrations to a disposable copy of a populated stage 14 preview database.
import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL);
assert.match(url.pathname, /^\/dental_preview_[0-9a-f]{12}$/);
const target = new Client({ connectionString: url.toString() });
await target.connect();
try {
  const { rows: tables } = await target.query(`
    SELECT tablename, quote_ident(tablename) AS identifier FROM pg_tables
    WHERE schemaname=current_schema() AND tablename <> '_prisma_migrations' ORDER BY tablename
  `);
  assert.ok(tables.some((table) => table.tablename === "StudyGroup"));
  assert.ok(tables.every((table) => table.tablename !== "VideoLecture"));
  async function snapshot() {
    const data = {};
    for (const table of tables) {
      const row =
        table.tablename === "Question"
          ? "to_jsonb(t) - ARRAY['videoId','atSec','aiGenerated','sourceQuote','sourceSec','sourceVideoId']"
          : table.tablename === "ImportJob"
            ? "to_jsonb(t) - ARRAY['videoId','videoRevision','report']"
            : "to_jsonb(t)";
      const {
        rows: [result],
      } = await target.query(`
        SELECT count(*)::int AS count, md5(coalesce(string_agg(body::text, E'\\n' ORDER BY body::text), '')) AS digest
        FROM (SELECT ${row} AS body FROM ${table.identifier} t) s
      `);
      data[table.tablename] = result;
    }
    return data;
  }
  const before = await snapshot();
  for (const table of [
    "User",
    "GapAnswer",
    "GapAttempt",
    "TopicProgress",
    "TestRun",
    "QuestionAttempt",
    "Card",
    "ReviewLog",
    "Payment",
    "Subscription",
    "GroupMember",
  ])
    assert.ok(
      before[table].count > 0,
      `Supply a stage 14 preview database with ${table} rows`,
    );
  const migration = spawnSync("corepack", ["pnpm", "db:migrate"], {
    stdio: "inherit",
  });
  assert.equal(migration.status, 0);
  assert.deepEqual(await snapshot(), before);
  const {
    rows: [result],
  } = await target.query(`
    SELECT (SELECT count(*)::int FROM "VideoLecture") AS videos,
      (SELECT count(*)::int FROM "VideoProgress") AS viewing,
      (SELECT count(*)::int FROM "Question" WHERE "videoId" IS NOT NULL OR "aiGenerated") AS video_questions
  `);
  assert.deepEqual(result, { videos: 0, viewing: 0, video_questions: 0 });
  console.log(
    JSON.stringify({
      unchangedTables: tables.length,
      rows: Object.fromEntries(
        Object.entries(before).map(([name, row]) => [name, row.count]),
      ),
    }),
  );
} finally {
  await target.end();
}
