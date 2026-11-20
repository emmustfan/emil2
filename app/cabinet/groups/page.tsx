import Link from "next/link";
import { requireUser } from "@/lib/auth/server";
import { JoinGroupForm, LeaveGroup } from "@/components/groups/student-forms";
import { studentGroups } from "@/lib/groups/queries";
import { currentGroupNotice } from "@/lib/groups/notice";
import { normalizeJoinCode } from "@/lib/groups/input";
import { membershipLabels } from "@/lib/groups/labels";

export const metadata = {
  title: "Мои группы",
  referrer: "no-referrer" as const,
};

export default async function CabinetGroups({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const user = await requireUser();
  const [memberships, notice, search] = await Promise.all([
    studentGroups(user.id),
    currentGroupNotice(),
    searchParams,
  ]);
  const code =
    typeof search.code === "string"
      ? (normalizeJoinCode(search.code) ?? "")
      : "";
  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-semibold">Мои группы</h1>
      <div className="grid gap-3">
        {memberships.map(({ group, status }) => (
          <article key={group.id} className="emal-panel space-y-2">
            <h2 className="text-lg font-semibold">{group.name}</h2>
            <p className="text-sm">
              {group.faculty.title} · {group.course} курс · {group.academicYear}
            </p>
            <p>
              {membershipLabels[status]}
              {group.archivedAt ? " · Группа архивирована" : ""}
            </p>
            {!user.readOnly &&
              (status === "ACTIVE" || status === "PENDING") && (
                <LeaveGroup id={group.id} pending={status === "PENDING"} />
              )}
          </article>
        ))}
        {!memberships.length && <p>У вас пока нет групп и заявок.</p>}
      </div>
      {!user.readOnly &&
        (notice ? (
          <JoinGroupForm
            key={code}
            code={code}
            notice={notice}
            student={{
              firstName: user.firstName,
              lastName: user.lastName,
              middleName: user.middleName,
              studentNumber: user.studentNumber,
            }}
          />
        ) : (
          <p>
            Вступление временно недоступно. Уведомление ещё не опубликовано.
          </p>
        ))}
      {user.readOnly && notice && (
        <Link className="underline" href="/legal/group-notice">
          Что видит преподаватель
        </Link>
      )}
    </main>
  );
}
