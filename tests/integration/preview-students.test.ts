import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { it, expect } from "vitest";
it("seeds twelve consistent preview learners through domain services, preserves manual changes, refuses unsafe targets and meets the 312-student budget", async () => {
  const source = new URL(process.env.DATABASE_URL!),
    database = `dental_preview_${randomBytes(6).toString("hex")}`,
    target = new URL(source);
  target.pathname = "/" + database;
  const admin = new Client({ connectionString: source.toString() });
  await admin.connect();
  let created = false,
    db: Client | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    db = new Client({ connectionString: target.toString() });
    await db.connect();
    await db.query("CREATE EXTENSION IF NOT EXISTS vector");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: target.toString(),
      NODE_ENV: "test",
      ADMIN_EMAILS: "owner@example.ru",
      LLM_PROVIDER: "mock",
      PAYMENTS_PROVIDER: "mock",
      MAIL_TRANSPORT: "log",
      STORAGE_DRIVER: "local",
    };
    function run(
      cmd: string,
      args: string[],
      override: Partial<NodeJS.ProcessEnv> = {},
    ) {
      return spawnSync(cmd, args, {
        env: { ...env, ...override },
        encoding: "utf8",
        timeout: 180000,
      });
    }
    for (const args of [
      ["pnpm", "db:migrate"],
      ["pnpm", "db:seed"],
    ]) {
      const r = run("corepack", args);
      expect(r.status, r.stdout + r.stderr).toBe(0);
    }
    const seed = run(process.execPath, [
      "--import",
      "tsx",
      "scripts/preview/seed.ts",
    ]);
    expect(seed.status, seed.stdout + seed.stderr).toBe(0);
    const users = (
      await db.query(
        `SELECT id,name,email,"consentPdAt" FROM "User" WHERE email LIKE 'demo-student-%@example.ru' ORDER BY email`,
      )
    ).rows;
    expect(users).toHaveLength(12);
    expect(
      users.every(
        (u) => u.name.startsWith("Демо ") && u.name.endsWith("(демо)"),
      ),
    ).toBe(true);
    expect(users.slice(0, 3).every((u) => u.consentPdAt)).toBe(true);
    expect(
      Number(
        (await db.query(`SELECT count(DISTINCT "userId") FROM "GapAttempt"`))
          .rows[0].count,
      ),
    ).toBe(12);
    expect(
      Number(
        (await db.query(`SELECT count(*) FROM "GapAttempt" WHERE practice`))
          .rows[0].count,
      ),
    ).toBeGreaterThan(6);
    expect(
      Number(
        (await db.query(`SELECT count(*) FROM "ReviewLog"`)).rows[0].count,
      ),
    ).toBeGreaterThan(0);
    expect(
      Number(
        (
          await db.query(
            `SELECT count(*) FROM "AccessGrant" WHERE reason='демо'`,
          )
        ).rows[0].count,
      ),
    ).toBeGreaterThan(0);
    expect(
      (
        await db.query(
          `SELECT t.status,t."needsExpertReview" FROM "Topic" t JOIN "Subject" s ON s.id=t."subjectId" WHERE s.slug='progress-dental-demo'`,
        )
      ).rows[0],
    ).toEqual({ status: "PUBLISHED", needsExpertReview: true });
    expect(
      (
        await db.query(
          `SELECT status FROM "Topic" WHERE slug='fdi-visual-demo' AND "subjectId"<>(SELECT id FROM "Subject" WHERE slug='progress-dental-demo')`,
        )
      ).rows[0].status,
    ).toBe("DRAFT");
    expect(
      Number(
        (
          await db.query(
            `SELECT count(*) FROM "TestRun" WHERE "userId"=ANY($1::text[]) AND (score<0.6 OR score>0.8)`,
            [users.slice(2, 6).map((u) => u.id)],
          )
        ).rows[0].count,
      ),
    ).toBe(0);
    expect(
      Number(
        (
          await db.query(
            `SELECT count(*) FROM "TestRun" WHERE "userId"=ANY($1::text[]) AND (score<0.9 OR score>1)`,
            [users.slice(0, 2).map((u) => u.id)],
          )
        ).rows[0].count,
      ),
    ).toBe(0);
    await db.query(
      `UPDATE "User" SET name='Ручная правка (демо)',email='manual-demo-email@example.test' WHERE id=$1`,
      [users[0].id],
    );
    const tables = [
      "User",
      "Subject",
      "Topic",
      "Question",
      "Gap",
      "GapAnswer",
      "GapAttempt",
      "TestRun",
      "QuestionAttempt",
      "TopicProgress",
      "Card",
      "ReviewLog",
      "AccessGrant",
      "TutorConversation",
      "TutorMessage",
      "Event",
      "AppSetting",
    ];
    async function snapshot() {
      const result: Record<string, string> = {};
      for (const table of tables)
        result[table] = (
          await db!.query(
            `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) AS hash FROM "${table}" t`,
          )
        ).rows[0].hash;
      return result;
    }
    const before = await snapshot(),
      repeat = run(process.execPath, [
        "--import",
        "tsx",
        "scripts/preview/seed.ts",
      ]);
    expect(repeat.status, repeat.stdout + repeat.stderr).toBe(0);
    expect(await snapshot()).toEqual(before);
    for (const override of [
      { NODE_ENV: "production" as const },
      { DATABASE_URL: source.toString() },
    ]) {
      const denied = run(
        process.execPath,
        ["--import", "tsx", "scripts/preview/students-demo.ts"],
        override,
      );
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain(
        "Demo students require a preview database",
      );
      expect(await snapshot()).toEqual(before);
    }
    const bench = run(process.execPath, [
      "--import",
      "tsx",
      "scripts/ops/check-stage12a-preview.ts",
    ]);
    expect(bench.status, bench.stdout + bench.stderr).toBe(0);
    const report = JSON.parse(bench.stdout.trim().split("\n").at(-1)!);
    expect(report.syntheticStudents).toBe(300);
    expect(report.totalStudents).toBeGreaterThanOrEqual(312);
    expect(report.p95Ms).toBeLessThanOrEqual(700);
    console.log("Progress benchmark:", JSON.stringify(report));
  } finally {
    await db?.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
}, 240000);
