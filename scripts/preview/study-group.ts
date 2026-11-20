import { getDb } from "../../lib/db";
import { lockRoleAccess } from "../../lib/auth/role-lock";
import { currentLegal } from "../../lib/auth/legal";
import { academicYear } from "../../lib/groups/input";
import { currentGroupNotice } from "../../lib/groups/notice";
import {
  assertStudentPreview,
  demoStudentId,
  studentProfiles,
} from "./student-profiles";

export async function ensureDemoStudyGroup(now: Date) {
  assertStudentPreview(process.env.DATABASE_URL, process.env.NODE_ENV);
  const legal = await currentLegal();
  const db = getDb();
  await db.$transaction(
    async (tx) => {
      await lockRoleAccess(tx, true);
      const key = "preview.studyGroupReady";
      if (await tx.appSetting.findUnique({ where: { key } })) return;
      const notice = await currentGroupNotice(tx);
      if (!notice)
        throw new Error("Seed the group notice before the preview group");
      const faculty = await tx.faculty.findUniqueOrThrow({
        where: { slug: "stomatology" },
      });
      const subjects = await tx.subject.findMany({
        where: {
          status: "PUBLISHED",
          slug: {
            in: ["platform-demo", "learning-demo", "progress-dental-demo"],
          },
          department: { slug: "unassigned", facultyId: faculty.id },
        },
        select: { id: true },
      });
      if (!subjects.length)
        throw new Error("Seed preview subjects before the preview group");
      const owner = await tx.user.findUniqueOrThrow({
        where: { email: "owner@example.ru" },
      });
      const teacher = await tx.user.upsert({
        where: { email: "teacher@example.ru" },
        create: {
          email: "teacher@example.ru",
          name: "Учитель для просмотра",
          role: "EDITOR",
        },
        update: {},
      });
      const group = await tx.studyGroup.create({
        data: {
          facultyId: faculty.id,
          name: "Демо-группа 101",
          course: 1,
          academicYear: academicYear(now),
        },
      });
      for (const { id: subjectId } of subjects) {
        const scopeKey = "subject:" + subjectId;
        const existing = await tx.roleAssignment.findFirst({
          where: {
            userId: teacher.id,
            OR: [
              { subjectId },
              { department: { slug: "unassigned", facultyId: faculty.id } },
            ],
          },
        });
        if (!existing && teacher.role !== "ADMIN")
          await tx.roleAssignment.create({
            data: {
              userId: teacher.id,
              role: "REVIEWER",
              subjectId,
              scopeKey,
              assignedById: owner.id,
            },
          });
        await tx.groupSubject.create({
          data: {
            groupId: group.id,
            subjectId,
            createdById: owner.id,
            teachers: {
              create: {
                teacherId: teacher.id,
                assignedById: owner.id,
              },
            },
          },
        });
      }
      if (teacher.role === "USER")
        await tx.user.update({
          where: { id: teacher.id },
          data: { role: "EDITOR", roleRevision: { increment: 1 } },
        });
      const acceptance = {
        noticeVersion: notice.version,
        noticeAcceptedAt: now,
        requestedAt: now,
      };
      for (const profile of studentProfiles()) {
        const user =
          (await tx.user.findUnique({
            where: { id: demoStudentId(profile.index) },
          })) ??
          (await tx.user.findUnique({ where: { email: profile.email } }));
        if (!user || user.blockedAt || user.deletedAt || user.role !== "USER")
          continue;
        const [, firstName, lastName] = profile.name.split(" ");
        if (!user.firstName || !user.lastName)
          await tx.user.update({
            where: { id: user.id },
            data: {
              firstName: user.firstName ?? firstName,
              lastName: user.lastName ?? lastName,
            },
          });
        await tx.groupMember.create({
          data: {
            groupId: group.id,
            userId: user.id,
            status: "ACTIVE",
            decidedAt: now,
            ...acceptance,
          },
        });
      }
      for (const firstName of ["Север", "Весна"]) {
        const number = firstName === "Север" ? "01" : "02";
        const email = `demo-applicant-${number}@example.ru`;
        const user = await tx.user.upsert({
          where: { email },
          create: {
            email,
            name: `Демо ${firstName} Заявка (демо)`,
            firstName,
            lastName: "Заявка",
            emailVerifiedAt: now,
            consentPdAt: now,
            consentPdVersion: legal.consent.version,
            offerVersion: legal.offer.version,
            university: "Вымышленный учебный стенд (демо)",
            course: 1,
          },
          update: {},
        });
        if (!user.blockedAt && !user.deletedAt && user.role === "USER")
          await tx.groupMember.create({
            data: {
              groupId: group.id,
              userId: user.id,
              status: "PENDING",
              ...acceptance,
            },
          });
      }
      await tx.appSetting.create({ data: { key, value: group.id } });
    },
    { timeout: 15000 },
  );
}
