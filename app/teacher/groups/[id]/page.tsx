import Link from "next/link";
import { requireEditor } from "@/lib/auth/server";
import { contentPage } from "@/lib/content/page";
import { WorkspaceShell } from "@/components/workspace/shell";
import {
  GroupButtons,
  GroupSelectAction,
} from "@/components/groups/staff-actions";
import { GroupInvite } from "@/components/groups/invite";
import { staffGroup } from "@/lib/groups/queries";
import { journalPath } from "@/lib/progress/routes";

export const metadata = {
  title: "Учебная группа",
  referrer: "no-referrer" as const,
};

function displayPerson(person: {
  name: string | null;
  email: string | null;
  telegramUsername?: string | null;
}) {
  const contact =
    person.email ||
    (person.telegramUsername ? "@" + person.telegramUsername : "");
  return [person.name, contact].filter(Boolean).join(" · ") || "Пользователь";
}

export default async function StudyGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const actor = await requireEditor();
  const [{ id }, { q: value }] = await Promise.all([params, searchParams]);
  const q = typeof value === "string" ? value.slice(0, 200) : "";
  const data = await contentPage(() => staffGroup(actor, id, q));
  const {
    group,
    permissions,
    subjects,
    available,
    members,
    canSearchTeachers,
  } = data;
  const pending = members.filter((member) => member.status === "PENDING");
  const active = members.filter((member) => member.status === "ACTIVE");
  return (
    <WorkspaceShell area="teacher">
      <main className="mx-auto max-w-5xl space-y-6">
        <Link className="text-sm underline" href="/teacher/groups">
          ← Учебные группы
        </Link>
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">{group.name}</h1>
          <p>
            {group.faculty.title} · {group.course} курс · {group.academicYear}
          </p>
          {group.archivedAt && <p>Архивная группа</p>}
          {permissions.roster && (
            <nav aria-label="Разделы группы" className="flex flex-wrap gap-4">
              <a href="#subjects" className="underline">
                Предметы и преподаватели
              </a>
              <a href="#applications" className="underline">
                Заявки и участники
              </a>
            </nav>
          )}
        </header>
        {permissions.manage && (
          <div className="grid gap-4 md:grid-cols-2">
            <GroupInvite
              id={id}
              code={group.joinCode}
              expiresAt={group.joinCodeExpiresAt}
            />
            <section className="emal-panel space-y-3">
              <h2 className="text-xl font-semibold">Зачисление</h2>
              <p>
                {group.requireApproval
                  ? "Заявки требуют одобрения."
                  : "Новые заявки одобряются автоматически."}
              </p>
              <GroupButtons
                id={id}
                buttons={[
                  {
                    label: group.requireApproval
                      ? "Включить автоматическое зачисление"
                      : "Требовать одобрение заявок",
                    input: {
                      action: "approval",
                      requireApproval: !group.requireApproval,
                    },
                  },
                  {
                    label: "Архивировать группу",
                    input: { action: "archive" },
                    confirmText:
                      "Архивировать группу? Код вступления и доступ по зачислению перестанут действовать.",
                  },
                ]}
              />
            </section>
          </div>
        )}
        <section id="subjects" className="emal-panel space-y-4">
          <h2 className="text-xl font-semibold">Предметы и преподаватели</h2>
          {available.length > 0 && (
            <GroupSelectAction
              id={id}
              action="open-subject"
              options={available}
              label="Предмет"
              button="Открыть предмет"
            />
          )}
          {canSearchTeachers && (
            <form role="search" className="flex flex-wrap items-end gap-3">
              <label className="w-full max-w-sm space-y-1 text-sm font-medium">
                Имя, email или Telegram преподавателя
                <input
                  className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3"
                  name="q"
                  defaultValue={q}
                  maxLength={200}
                  required
                />
              </label>
              <button className="lesson-primary">Найти преподавателя</button>
            </form>
          )}
          {!subjects.length && <p>Нет доступных предметов группы.</p>}
          {subjects.map(({ subject, teachers, manageable, candidates }) => (
            <article
              className="space-y-3 rounded-xl border border-stone-200 p-4"
              key={subject.id}
            >
              <h3 className="text-lg font-semibold">{subject.title}</h3>
              {!actor.readOnly && (
                <Link className="underline" href={journalPath(id, subject.id)}>
                  Открыть журнал
                </Link>
              )}
              {teachers.length ? (
                <ul className="space-y-2">
                  {teachers.map(({ teacher }) => (
                    <li
                      key={teacher.id}
                      className="flex flex-wrap items-start gap-3 text-sm"
                    >
                      <span className="py-2">{displayPerson(teacher)}</span>
                      {manageable && (
                        <GroupButtons
                          id={id}
                          buttons={[
                            {
                              label: "Снять назначение",
                              input: {
                                action: "remove-teacher",
                                subjectId: subject.id,
                                teacherId: teacher.id,
                              },
                            },
                          ]}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm">Преподаватели не назначены.</p>
              )}
              {manageable &&
                q.trim() &&
                (candidates.length > 0 ? (
                  <GroupSelectAction
                    id={id}
                    action="assign-teacher"
                    subjectId={subject.id}
                    options={candidates.map((candidate) => ({
                      id: candidate.id,
                      title: displayPerson(candidate),
                    }))}
                    label="Преподаватель"
                    button="Назначить преподавателя"
                  />
                ) : (
                  <p className="text-sm">
                    Подходящих новых преподавателей не найдено.
                  </p>
                ))}
              {manageable && (
                <GroupButtons
                  id={id}
                  buttons={[
                    {
                      label: "Закрыть предмет",
                      input: { action: "close-subject", subjectId: subject.id },
                      confirmText:
                        "Закрыть предмет? Участники потеряют доступ по зачислению, назначения преподавателей по этому предмету будут сняты.",
                    },
                  ]}
                />
              )}
            </article>
          ))}
        </section>
        {permissions.roster && (
          <section id="applications" className="emal-panel space-y-5">
            <h2 className="text-xl font-semibold">Заявки и участники</h2>
            <h3 className="text-lg font-semibold">Заявки на рассмотрении</h3>
            {permissions.members && pending.length > 0 && (
              <GroupButtons
                id={id}
                buttons={[
                  {
                    label: "Одобрить все заявки",
                    input: { action: "decide", status: "ACTIVE" },
                    confirmText: "Одобрить все ожидающие заявки этой группы?",
                  },
                  {
                    label: "Отклонить все заявки",
                    input: { action: "decide", status: "REJECTED" },
                    confirmText: "Отклонить все ожидающие заявки этой группы?",
                  },
                ]}
              />
            )}
            {!pending.length && <p>Новых заявок нет.</p>}
            {pending.map((member) => (
              <Member key={member.userId} member={member}>
                {permissions.members && (
                  <GroupButtons
                    id={id}
                    buttons={[
                      {
                        label: "Одобрить",
                        input: {
                          action: "decide",
                          status: "ACTIVE",
                          userId: member.userId,
                        },
                      },
                      {
                        label: "Отклонить",
                        input: {
                          action: "decide",
                          status: "REJECTED",
                          userId: member.userId,
                        },
                      },
                    ]}
                  />
                )}
              </Member>
            ))}
            <h3 className="text-lg font-semibold">Зачисленные студенты</h3>
            {!active.length && <p>Зачисленных студентов пока нет.</p>}
            {active.map((member) => (
              <Member key={member.userId} member={member}>
                {(data.selfReported.get(member.userId) ?? []).map((video) => (
                  <p key={video.id} className="text-sm">
                    {video.title} · просмотр отмечен студентом
                  </p>
                ))}
                {permissions.members && (
                  <GroupButtons
                    id={id}
                    buttons={[
                      {
                        label: "Исключить",
                        input: {
                          action: "decide",
                          status: "REMOVED",
                          userId: member.userId,
                        },
                        confirmText:
                          "Исключить студента? Доступ по зачислению прекратится.",
                      },
                    ]}
                  />
                )}
              </Member>
            ))}
          </section>
        )}
      </main>
    </WorkspaceShell>
  );
}

function Member({
  member,
  children,
}: {
  member: Awaited<ReturnType<typeof staffGroup>>["members"][number];
  children: React.ReactNode;
}) {
  const user = member.user;
  const name =
    [user.lastName, user.firstName, user.middleName]
      .filter(Boolean)
      .join(" ") ||
    user.name ||
    "Студент";
  const contact =
    user.email ||
    (user.telegramUsername
      ? "@" + user.telegramUsername
      : user.telegramId
        ? "Telegram " + user.telegramId.toString()
        : null);
  return (
    <article className="space-y-2 rounded-xl border border-stone-200 p-4">
      <h4 className="font-semibold">{name}</h4>
      {contact && <p className="break-all text-sm">{contact}</p>}
      <p className="text-sm">
        Заявка от{" "}
        {member.requestedAt.toLocaleString("ru-RU", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Europe/Moscow",
        })}{" "}
        (МСК)
      </p>
      {children}
    </article>
  );
}
