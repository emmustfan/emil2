import Link from "next/link";
import { getDb } from "@/lib/db";
import { contentRu } from "@/lib/i18n/ru";
export async function MaterialQueue({
  actor,
}: {
  actor: { id: string; role: string };
}) {
  const topics = await getDb().topic.findMany({
    where: {
      status: { in: ["DRAFT", "REVIEW"] },
      ...(actor.role === "ADMIN"
        ? {}
        : {
            subject: { teachingAssignments: { some: { teacherId: actor.id } } },
          }),
    },
    select: {
      id: true,
      title: true,
      status: true,
      subject: { select: { title: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 6,
  });
  return (
    <section className="emal-panel material-queue">
      <div className="student-heading">
        <div>
          <h2>Материалы в работе</h2>
          <p>Последние черновики и уроки на проверке</p>
        </div>
      </div>
      {topics.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr>
                <th>Урок</th>
                <th>Предмет</th>
                <th>Статус</th>
                <th>
                  <span className="sr-only">Действие</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {topics.map((topic) => (
                <tr key={topic.id}>
                  <td>{topic.title}</td>
                  <td>{topic.subject.title}</td>
                  <td>
                    <span
                      className={`material-status ${topic.status === "REVIEW" ? "is-review" : ""}`}
                    >
                      {contentRu.statuses[topic.status]}
                    </span>
                  </td>
                  <td>
                    <Link
                      className="material-edit"
                      href={`/admin/topics/${topic.id}`}
                    >
                      Редактировать →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="emal-empty">
          Черновиков пока нет. Откройте предмет, чтобы создать первый урок.
        </p>
      )}
    </section>
  );
}
