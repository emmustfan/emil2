import { getDb } from "../../lib/db";
export async function ensureRoleDemo() {
  const db = getDb(),
    name = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  if (!/^dental_preview_[a-f0-9]{12}$/.test(name))
    throw new Error("Role preview requires its own preview database");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('preview:roles',0))`;
    const key = "preview.rolesReady";
    if (await tx.appSetting.findUnique({ where: { key } })) return;
    const subject = await tx.subject.findUniqueOrThrow({
        where: { slug: "platform-demo" },
      }),
      owner = await tx.user.findUnique({
        where: { email: "owner@example.ru" },
        select: { id: true },
      });
    const existing = await tx.user.findUnique({
      where: { email: "teacher@example.ru" },
    });
    if (!existing) {
      const teacher = await tx.user.create({
        data: {
          email: "teacher@example.ru",
          name: "Учитель для просмотра",
          role: "EDITOR",
        },
      });
      await tx.teacherSubject.create({
        data: {
          teacherId: teacher.id,
          subjectId: subject.id,
          assignedById: owner?.id,
        },
      });
    }
    if (!(await tx.user.findUnique({ where: { email: "student@example.ru" } })))
      await tx.user.create({
        data: {
          email: "student@example.ru",
          name: "Ученик для просмотра",
          role: "USER",
        },
      });
    await tx.appSetting.create({ data: { key, value: true } });
  });
}
