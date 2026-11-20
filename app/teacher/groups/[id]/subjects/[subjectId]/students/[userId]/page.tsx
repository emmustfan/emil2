import Link from "next/link";
import { getCurrentSession } from "@/lib/auth/server";
import { contentPage } from "@/lib/content/page";
import { WorkspaceShell } from "@/components/workspace/shell";
import { StudentProgressCard } from "@/components/progress/student-card";
import { studentProgress } from "@/lib/progress/student";
import { journalPath } from "@/lib/progress/routes";

export const metadata = {
  title: "Карточка студента",
  referrer: "no-referrer" as const,
};

export default async function GroupStudentPage({
  params,
}: {
  params: Promise<{ id: string; subjectId: string; userId: string }>;
}) {
  const [{ id, subjectId, userId }, session] = await Promise.all([
    params,
    getCurrentSession(),
  ]);
  const data = await contentPage(() =>
    studentProgress(userId, {
      viewerId: session && { id: session.user.id, readOnly: session.readOnly },
      groupId: id,
      subjectId,
    }),
  );
  return (
    <WorkspaceShell area="teacher">
      <main className="mx-auto max-w-5xl space-y-5">
        <Link href={journalPath(id, subjectId)} className="underline">
          ← Журнал группы
        </Link>
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">{data.user.name}</h1>
          <p>
            {data.group?.name} · {data.subjects[0]?.title}
          </p>
          {data.user.studentNumber && (
            <p>Номер зачётки: {data.user.studentNumber}</p>
          )}
        </header>
        {!data.user.deleted && (
          <StudentProgressCard
            data={data}
            timeZone={session?.user.timezone ?? "Europe/Moscow"}
          />
        )}
      </main>
    </WorkspaceShell>
  );
}
