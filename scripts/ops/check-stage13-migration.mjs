// Run with DATABASE_URL pointing to a populated stage 12B preview database.
import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  const { rows: before } = await db.query(
    'SELECT * FROM "TeacherSubject" ORDER BY "teacherId", "subjectId"',
  );
  assert.ok(
    before.length > 0,
    "Populate at least one teacher assignment before testing",
  );
  const tables = [
    "User",
    "Subject",
    "Topic",
    "TopicRevision",
    "GapAnswer",
    "GapAttempt",
    "Card",
    "TestRun",
    "QuestionAttempt",
    "TopicProgress",
    "ReviewLog",
    "Payment",
    "Subscription",
    "Session",
    "SecurityAudit",
  ];
  async function snapshot() {
    const result = {};
    for (const table of tables) {
      const { rows } = await db.query(`SELECT count(*)::int AS count,
        md5(COALESCE(string_agg(body::text, E'\\n' ORDER BY body::text), '')) AS digest
        FROM (SELECT to_jsonb(row) - 'departmentId' AS body FROM "${table}" row) rows`);
      result[table] = rows[0];
    }
    return result;
  }
  const original = await snapshot();
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20261118090000_org/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.query(sql.replace(/^BEGIN;\s*/, "").replace(/COMMIT;\s*$/, ""));
  const { rows: after } =
    await db.query(`SELECT "userId" AS "teacherId", "subjectId", "assignedById", "createdAt" FROM "RoleAssignment"
    WHERE role='AUTHOR' AND "scopeKey"='subject:' || "subjectId" ORDER BY "userId", "subjectId"`);
  assert.deepEqual(after, before);
  assert.deepEqual(await snapshot(), original);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM "Subject" WHERE "departmentId" <> $1',
        ["org-unassigned"],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query(`SELECT to_regclass('"TeacherSubject"') AS old`)).rows[0]
      .old,
    null,
  );
  console.log(
    JSON.stringify({
      assignmentsBefore: before.length,
      authorAssignmentsAfter: after.length,
      unchangedTables: original,
    }),
  );
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
