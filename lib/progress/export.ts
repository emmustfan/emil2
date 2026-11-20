import { getDb } from "../db";
import { ContentError } from "../content/errors";
import type { ContentReader } from "../org";
import type { GroupSubject } from "./access";
import { csv } from "./csv";
import { dateTime, percent } from "./display";
import { readJournal, type JournalFilters } from "./journal";

export function exportJournal(
  viewer: ContentReader | null | undefined,
  scope: GroupSubject,
  filters: JournalFilters,
  now = new Date(),
) {
  return getDb().$transaction(
    async (db) => {
      const { rows, topics } = await readJournal(
        db,
        viewer,
        scope,
        filters,
        now,
      );
      if (!rows.length)
        throw new ContentError("Нет студентов для выгрузки.", 422);
      const text = csv([
        [
          "Студент",
          "Зачисление",
          "Завершено тем",
          "Всего тем",
          "Средний балл",
          "К повторению",
          "Просрочено",
          "Последняя активность (МСК)",
          ...topics.map((t) => t.title),
        ],
        ...rows.map((row) => [
          row.name,
          row.removed ? "Исключён" : "Зачислен",
          row.deleted ? null : row.completed,
          row.deleted ? null : row.total,
          percent(row.average),
          row.deleted ? null : row.due,
          row.deleted ? null : row.overdue,
          dateTime(row.lastActivity),
          ...row.cells.map((cell) =>
            row.deleted
              ? null
              : [
                  cell.state,
                  percent(cell.accuracy),
                  percent(cell.score),
                  ...cell.videos.map(
                    (video) => `${video.title} — ${video.method}`,
                  ),
                ].join(" · "),
          ),
        ]),
      ]);
      await db.studentDataAccess.createMany({
        data: rows.map((row) => ({
          viewerId: typeof viewer === "string" ? viewer : viewer!.id,
          studentId: row.id,
          ...scope,
          view: "export",
        })),
      });
      return text;
    },
    { isolationLevel: "RepeatableRead" },
  );
}
