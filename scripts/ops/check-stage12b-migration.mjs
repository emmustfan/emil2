// Read-only verification of additive DDL on a populated pre-12B database; always rolls back.
import "dotenv/config";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  assert.equal(
    (await db.query(`SELECT to_regclass('"ImpersonationSession"') AS name`))
      .rows[0].name,
    null,
    "Use a pre-12B database copy",
  );
  async function snapshot() {
    const result = {};
    for (const table of [
      "User",
      "Session",
      "GapAnswer",
      "GapAttempt",
      "Card",
      "ReviewLog",
      "TestRun",
      "QuestionAttempt",
      "TopicProgress",
      "UsageCounter",
      "Event",
      "TutorMessage",
      "Payment",
      "Subscription",
    ]) {
      result[table] = (
        await db.query(
          `SELECT count(*)::int AS count, md5(COALESCE(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text), '')) AS digest FROM "${table}" t`,
        )
      ).rows[0];
    }
    return result;
  }
  const before = await snapshot();
  await db.query(
    await readFile(
      new URL(
        "../../prisma/migrations/20261115030000_impersonation/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const after = await snapshot();
  assert.deepEqual(after, before);
  assert.equal(
    (await db.query(`SELECT count(*)::int AS n FROM "ImpersonationSession"`))
      .rows[0].n,
    0,
  );
  console.log(
    JSON.stringify({ before, after, identical: true, rollback: true }),
  );
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
