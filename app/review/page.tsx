import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/server";
import { getReviewQueue } from "@/lib/srs/service";
import { LearningShell } from "@/components/lessons/shell";
import { ReviewSession } from "@/components/review/session";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Повторение · Учебная платформа",
  robots: { index: false, follow: false },
};
export default async function Review() {
  const user = await requireUser(),
    queue = await getReviewQueue(user.id);
  return (
    <LearningShell>
      <div className="mx-auto mb-8 max-w-3xl">
        <p className="text-xs font-semibold tracking-widest text-emerald-800 uppercase">
          Практика на сегодня
        </p>
        <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Повторение</h1>
        <p className="mt-4 text-sm leading-7 text-stone-600">
          Вернитесь к материалу, который пора вспомнить. Оценка подскажет, когда
          показать карточку снова.
        </p>
      </div>
      <ReviewSession initial={queue} />
    </LearningShell>
  );
}
