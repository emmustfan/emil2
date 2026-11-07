import { z } from "zod";
import { getDb } from "@/lib/db";
const summarySchema = z.object({
  correct: z.number().int().min(0).max(3),
  strongTopicIds: z.array(z.string()),
  weakTopicIds: z.array(z.string()),
});
export async function SavedDiagnostic({ userId }: { userId: string }) {
  const user = await getDb().user.findUniqueOrThrow({
    where: { id: userId },
    select: { diagnostic: true, goal: true },
  });
  const parsed = summarySchema.safeParse(user.diagnostic);
  if (!parsed.success && !user.goal) return null;
  const summary = parsed.success ? parsed.data : null;
  const topics = summary
    ? await getDb().topic.findMany({
        where: {
          id: { in: [...summary.strongTopicIds, ...summary.weakTopicIds] },
          status: "PUBLISHED",
          subject: { status: "PUBLISHED" },
        },
        select: { id: true, title: true },
      })
    : [];
  const goals: Record<string, string> = {
    debt: "Закрыть долги",
    session: "Сдать сессию",
    gia: "Подготовиться к ГИА",
    understand: "Разобраться в предмете",
  };
  return (
    <section className="mt-7 rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="text-lg font-semibold">Ваше знакомство с платформой</h2>
      {user.goal && (
        <p className="mt-3 text-sm">Цель: {goals[user.goal] ?? user.goal}</p>
      )}
      {summary && (
        <>
          <p className="mt-3 text-sm">
            Диагностика: {summary.correct} из 3. Это ориентир для начала, а не
            оценка готовности к экзамену.
          </p>
          {[
            ["Уже знаете", summary.strongTopicIds],
            ["Стоит подтянуть", summary.weakTopicIds],
          ].map(([label, ids]) => (
            <p key={String(label)} className="mt-3 text-sm">
              <strong>{label}:</strong>{" "}
              {topics
                .filter((t) => (ids as string[]).includes(t.id))
                .map((t) => t.title)
                .join(", ") || "—"}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
