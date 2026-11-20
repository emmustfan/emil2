import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db";
import { currentLegal } from "../../lib/auth/legal";
import { createLessonFixture, cleanupLessonFixture } from "./lesson-fixture";

export async function createOrgFixture() {
  const db = getDb(),
    tag = randomUUID(),
    users: string[] = [];
  const faculty = await db.faculty.create({
    data: { slug: "org-" + tag, title: "Факультет проверки " + tag },
  });
  const a = await db.department.create({
    data: { facultyId: faculty.id, slug: "own", title: "Своя кафедра" },
  });
  const b = await db.department.create({
    data: { facultyId: faculty.id, slug: "other", title: "Чужая кафедра" },
  });
  const own = await createLessonFixture("org-own"),
    other = await createLessonFixture("org-other");
  await db.subject.update({
    where: { id: own.subject.id },
    data: { departmentId: a.id, title: "Предмет своей кафедры" },
  });
  await db.subject.update({
    where: { id: other.subject.id },
    data: { departmentId: b.id, title: "Предмет чужой кафедры" },
  });
  const legal = await currentLegal();
  async function user(
    name: string,
    role: "ADMIN" | "EDITOR" | "USER" = "USER",
  ) {
    const row = await db.user.create({
      data: {
        name,
        role,
        email: name.toLowerCase() + "-" + tag + "@example.test",
        emailVerifiedAt: new Date(),
        consentPdAt: new Date(),
        consentPdVersion: legal.consent.version,
        offerVersion: legal.offer.version,
        course: 1,
        university: "Фикстура",
      },
    });
    users.push(row.id);
    return row;
  }
  const head = await user("Head", "EDITOR"),
    author = await user("Author"),
    reviewer = await user("Reviewer"),
    admin = await user("Admin", "ADMIN");
  await db.roleAssignment.create({
    data: {
      userId: head.id,
      role: "DEPARTMENT_HEAD",
      departmentId: a.id,
      scopeKey: "department:" + a.id,
      assignedById: admin.id,
    },
  });
  return {
    own,
    other,
    a,
    b,
    faculty,
    head,
    author,
    reviewer,
    admin,
    async cleanup() {
      await db.importJob.deleteMany({
        where: { subjectId: { in: [own.subject.id, other.subject.id] } },
      });
      await cleanupLessonFixture(other);
      await cleanupLessonFixture(own, [], users);
      await db.department.deleteMany({ where: { facultyId: faculty.id } });
      await db.faculty.delete({ where: { id: faculty.id } });
    },
  };
}
export type OrgFixture = Awaited<ReturnType<typeof createOrgFixture>>;

export function readyTopic(subjectId: string) {
  return {
    subjectId,
    title: "Урок автора кафедры",
    slug: "org-lesson-" + randomUUID(),
    sectionId: null,
    order: 0,
    isFree: true,
    contentMd:
      "## Учебный текст\n\n" +
      Array.from(
        { length: 10 },
        (_, i) => `Пример ${i} [[ответ-${i}|вариант-${i}]].`,
      ).join("\n\n"),
    readingMinutes: 5,
    authorName: "Автор проверки",
    reviewerName: "Рецензент проверки",
    referencesMd: "Синтетический материал проверки.",
    reviewed: true,
  };
}

export function readyQuestion(order: number) {
  return {
    stem: "Учебный вопрос " + order,
    answerType: "SINGLE_CHOICE" as const,
    options: [
      { id: "a", text: "Первый" },
      { id: "b", text: "Второй" },
      { id: "c", text: "Третий" },
    ],
    correctOptionIds: ["a"],
    acceptedAnswers: [],
    explanation: "Объяснение к учебному вопросу.",
    sourceBlockKey: null,
    isDiagnostic: false,
    order,
  };
}
