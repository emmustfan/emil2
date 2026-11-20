// Run against a populated stage 13 preview database. The transaction is rolled back.
import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  const { rows: tables } = await db.query(
    `SELECT quote_ident(tablename) AS name, tablename
     FROM pg_tables WHERE schemaname=current_schema()
     AND tablename <> '_prisma_migrations' ORDER BY tablename`,
  );
  async function snapshot() {
    const result = {};
    for (const table of tables) {
      const row =
        table.tablename === "User"
          ? "to_jsonb(t) - ARRAY['firstName','lastName','middleName','studentNumber']"
          : "to_jsonb(t)";
      const {
        rows: [summary],
      } = await db.query(`
        SELECT count(*)::int AS count, md5(COALESCE(string_agg(row::text, E'\\n' ORDER BY row::text), '')) AS digest
        FROM (SELECT ${row} AS row FROM ${table.name} t) s
      `);
      result[table.tablename] = summary;
    }
    return result;
  }

  const before = await snapshot();
  for (const table of [
    "GapAnswer",
    "GapAttempt",
    "TestRun",
    "TopicProgress",
    "Card",
    "ReviewLog",
    "Payment",
    "Subscription",
    "RoleAssignment",
  ])
    assert.ok(
      before[table].count > 0,
      `Supply a preview database with ${table} data`,
    );
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20261120090000_groups/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.query(
    migration.replace(/^BEGIN;\s*/, "").replace(/COMMIT;\s*$/, ""),
  );
  assert.deepEqual(await snapshot(), before);
  const {
    rows: [profile],
  } = await db.query(
    'SELECT count(*)::int AS count FROM "User" WHERE "firstName" IS NOT NULL OR "lastName" IS NOT NULL OR "middleName" IS NOT NULL OR "studentNumber" IS NOT NULL',
  );
  assert.equal(profile.count, 0);
  for (const table of [
    "StudyGroup",
    "GroupMember",
    "GroupSubject",
    "GroupTeacher",
  ]) {
    const {
      rows: [result],
    } = await db.query(`SELECT count(*)::int AS count FROM "${table}"`);
    assert.equal(result.count, 0);
  }
  console.log(
    JSON.stringify({
      unchangedTables: tables.length,
      rows: Object.fromEntries(
        Object.entries(before).map(([table, data]) => [table, data.count]),
      ),
    }),
  );
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
