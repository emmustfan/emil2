import { currentReviewSummary } from "@/components/review/link";
import Link from "next/link";
import { requireUser } from "@/lib/auth/server";
import { AuthShell } from "@/components/auth/shell";
import { authRu } from "@/lib/i18n/ru";
export default async function Cabinet() {
  const user = await requireUser();
  const review = await currentReviewSummary();
  return (
    <AuthShell title={authRu.cabinetTitle} description={authRu.cabinetText}>
      <Link href="/subjects" className="mr-5 text-emerald-800 underline">
        Предметы и уроки
      </Link>
      <Link href="/cabinet/profile" className="text-emerald-800 underline">
        {authRu.profile}
      </Link>
      {review && (
        <section className="mt-7 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-lg font-semibold">Повторение</h2>
          <p className="mt-3 text-sm leading-7">
            Готово карточек: {review.dueCount}. Сегодня повторено:{" "}
            {review.reviewedToday}.
          </p>
          {review.nextDueAt && (
            <p className="mt-2 text-xs leading-6 text-stone-600">
              Следующее повторение:{" "}
              {new Intl.DateTimeFormat("ru-RU", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: review.timeZone,
              }).format(new Date(review.nextDueAt))}
              .
            </p>
          )}
          <Link href="/review" className="lesson-primary mt-4">
            Открыть повторение
          </Link>
        </section>
      )}
      {["ADMIN", "EDITOR"].includes(user.role) && (
        <Link href="/admin" className="ml-5 text-emerald-800 underline">
          {authRu.admin}
        </Link>
      )}
    </AuthShell>
  );
}
