import Link from "next/link";
import { BookOpen, Folder, FileText } from "lucide-react";
import { getDb } from "@/lib/db";
import { contentRu } from "@/lib/i18n/ru";

// Callers supply only subjects returned by the actor-scoped content services.
export async function ContentTree({
  subjects,
  canManageSubjects = false,
}: {
  subjects: { id: string; title: string }[];
  canManageSubjects?: boolean;
}) {
  const data = await getDb().subject.findMany({
    where: { id: { in: subjects.map((s) => s.id) } },
    select: {
      id: true,
      title: true,
      status: true,
      order: true,
      section_subjectId: {
        select: { id: true, title: true, order: true },
        orderBy: [{ order: "asc" }, { id: "asc" }],
      },
      topic_subjectId: {
        select: {
          id: true,
          title: true,
          sectionId: true,
          status: true,
          isFree: true,
          order: true,
        },
        orderBy: [{ order: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });
  return (
    <div className="content-library">
      <div
        className="content-hierarchy-guide"
        aria-label="Как устроены материалы"
      >
        <span>
          <BookOpen size={18} />
          <strong>1. Предмет</strong>
          <small>Весь учебный курс</small>
        </span>
        <span>
          <Folder size={18} />
          <strong>2. Раздел</strong>
          <small>Группа связанных уроков</small>
        </span>
        <span>
          <FileText size={18} />
          <strong>3. Урок</strong>
          <small>Методичка, задания и тест</small>
        </span>
      </div>
      <nav aria-label="Предметы, разделы и уроки" className="content-tree">
        {data.map((subject) => (
          <details open className="content-tree-subject" key={subject.id}>
            <summary>
              <BookOpen size={19} />
              <span className="content-level">Предмет</span>
              <Link href={`/admin/subjects/${subject.id}`}>
                {subject.title}
              </Link>
              <span className="material-status">
                {contentRu.statuses[subject.status]}
              </span>
              <small>{subject.topic_subjectId.length} ур.</small>
            </summary>
            <div className="content-tree-subject-actions">
              <Link href={`/admin/subjects/${subject.id}/editor`}>
                Открыть книгу →
              </Link>
              <Link href={`/admin/subjects/${subject.id}/editor?new=1`}>
                + Урок
              </Link>
              {canManageSubjects && (
                <Link href={`/admin/subjects/${subject.id}#subject-settings`}>
                  Настройки предмета
                </Link>
              )}
            </div>
            <ul>
              {[
                ...subject.section_subjectId,
                ...(subject.topic_subjectId.some((t) => !t.sectionId)
                  ? [{ id: "", title: "Без раздела", order: 0 }]
                  : []),
              ].map((section) => (
                <li key={section.id}>
                  <details open>
                    <summary>
                      <Folder size={16} />
                      <span className="content-level">Раздел</span>
                      <strong>{section.title}</strong>
                    </summary>
                    <ul>
                      {subject.topic_subjectId
                        .filter(
                          (topic) => (topic.sectionId ?? "") === section.id,
                        )
                        .map((topic) => (
                          <li key={topic.id} className="content-tree-lesson">
                            <FileText size={16} />
                            <span className="content-level">Урок</span>
                            <Link href={`/admin/topics/${topic.id}`}>
                              {topic.title}
                            </Link>
                            <span
                              className={`material-status ${topic.status === "REVIEW" ? "is-review" : ""}`}
                            >
                              {contentRu.statuses[topic.status]}
                            </span>
                            {topic.isFree && <small>Бесплатный</small>}
                          </li>
                        ))}
                    </ul>
                    {!subject.topic_subjectId.some(
                      (topic) => (topic.sectionId ?? "") === section.id,
                    ) && (
                      <p className="content-tree-empty">
                        Уроков пока нет. Добавьте первый в книге.
                      </p>
                    )}
                  </details>
                </li>
              ))}
            </ul>
            {!subject.section_subjectId.length &&
              !subject.topic_subjectId.length && (
                <p className="content-tree-empty">
                  Откройте книгу, создайте раздел и первый урок.
                </p>
              )}
          </details>
        ))}
        {!data.length && <p className="emal-empty">Предметов пока нет.</p>}
      </nav>
    </div>
  );
}
