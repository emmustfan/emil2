import { topicVideoIds } from "../video/catalog";
import { getDb } from "../db";
import type { ContentReader } from "../org";
import { searchGroupTeachers, groupAccess } from "../org/groups";

const studentName = {
  name: true,
  firstName: true,
  lastName: true,
  middleName: true,
} as const;

export function studentGroups(userId: string) {
  return getDb().groupMember.findMany({
    where: { userId },
    select: {
      status: true,
      group: {
        select: {
          id: true,
          name: true,
          course: true,
          academicYear: true,
          archivedAt: true,
          faculty: { select: { title: true } },
        },
      },
    },
    orderBy: { requestedAt: "desc" },
  });
}

export async function staffGroup(
  reader: ContentReader,
  id: string,
  rawQuery: string,
) {
  const { actor, group, permissions, subjectScope, teachingScope, oversees } =
    await groupAccess(reader, id);
  const active =
    !group.archivedAt && !group.faculty.archivedAt && !actor.readOnly;
  const db = getDb();
  const q = rawQuery.trim().slice(0, 200);
  const [subjects, available, members] = await Promise.all([
    db.groupSubject.findMany({
      where: {
        groupId: id,
        ...(oversees ? {} : { OR: [{ subject: subjectScope }, teachingScope] }),
      },
      select: {
        subject: { select: { id: true, title: true, departmentId: true } },
        teachers: {
          // Subject managers can see and remove existing assignments. Group
          // teachers see their own assignment in this view.
          where: oversees
            ? {}
            : {
                OR: [
                  { teacherId: actor.id },
                  { groupSubject: { subject: subjectScope } },
                ],
              },
          select: {
            teacher: { select: { id: true, name: true, email: true } },
          },
          orderBy: { teacherId: "asc" },
        },
      },
      orderBy: { subject: { title: "asc" } },
    }),
    active
      ? db.subject.findMany({
          where: subjectScope,
          select: { id: true, title: true, departmentId: true },
          orderBy: [{ title: "asc" }, { id: "asc" }],
        })
      : [],
    permissions.roster
      ? db.groupMember.findMany({
          where: {
            groupId: id,
            status: { in: ["PENDING", "ACTIVE"] },
            user: { deletedAt: null, anonymizedAt: null },
          },
          select: {
            userId: true,
            status: true,
            requestedAt: true,
            user: {
              select: {
                ...studentName,
                email: true,
                telegramUsername: true,
                telegramId: true,
              },
            },
          },
          orderBy: [{ requestedAt: "asc" }, { userId: "asc" }],
        })
      : [],
  ]);
  const manageable = new Set(available.map((subject) => subject.id));
  const subjectsToAssign = subjects.filter(({ subject }) =>
    manageable.has(subject.id),
  );
  const candidates = await searchGroupTeachers(
    subjectsToAssign.map(({ subject }) => subject),
    q,
  );
  const videoReports =
    permissions.roster &&
    !group.archivedAt &&
    !group.faculty.archivedAt &&
    members.length
      ? await db.videoProgress.findMany({
          where: {
            userId: {
              in: members
                .filter((member) => member.status === "ACTIVE")
                .map((member) => member.userId),
            },
            selfReported: true,
            completedAt: { not: null },
            video: {
              archivedAt: null,
              topic: {
                status: "PUBLISHED",
                subject: {
                  status: "PUBLISHED",
                  groupSubjects: {
                    some: {
                      groupId: id,
                      ...(actor.role === "ADMIN" ? {} : teachingScope),
                    },
                  },
                },
              },
            },
          },
          select: {
            userId: true,
            video: {
              select: {
                id: true,
                title: true,
                topic: { select: { id: true, contentMd: true } },
              },
            },
          },
          orderBy: { completedAt: "desc" },
        })
      : [];
  const publishedVideos = new Map<string, string[]>();
  const selfReported = new Map<string, { id: string; title: string }[]>();
  for (const report of videoReports) {
    const { video, userId } = report;
    let ids = publishedVideos.get(video.topic.id);
    if (!ids) {
      ids = topicVideoIds(video.topic.contentMd);
      publishedVideos.set(video.topic.id, ids);
    }
    if (!ids.includes(video.id)) continue;
    const items = selfReported.get(userId) ?? [];
    items.push({ id: video.id, title: video.title });
    selfReported.set(userId, items);
  }
  const opened = new Set(subjects.map(({ subject }) => subject.id));
  return {
    group,
    permissions,
    members,
    selfReported,
    subjects: subjects.map((entry) => ({
      ...entry,
      manageable: manageable.has(entry.subject.id),
      candidates:
        candidates
          .get(entry.subject.id)
          ?.filter(
            (candidate) =>
              !entry.teachers.some(
                ({ teacher }) => teacher.id === candidate.id,
              ),
          ) ?? [],
    })),
    available: available.filter((subject) => !opened.has(subject.id)),
    canSearchTeachers: subjectsToAssign.length > 0,
  };
}
