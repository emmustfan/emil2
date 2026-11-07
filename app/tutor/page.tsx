import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { LearningShell } from "@/components/lessons/shell";
import { tutorRu as t } from "@/lib/i18n/ru";
import { TutorWorkspace } from "@/components/tutor/workspace";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${t.title} · Учебная платформа`,
  robots: { index: false, follow: false },
};
export default async function Tutor({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  await requireUser();
  const subjects = await getDb().subject.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, title: true },
    orderBy: [{ order: "asc" }, { title: "asc" }],
  });
  const { subject } = await searchParams;
  return (
    <LearningShell>
      <div className="mx-auto mb-8 max-w-3xl">
        <h1 className="text-3xl font-semibold">{t.title}</h1>
        <p className="mt-4 text-sm leading-7 text-stone-600">
          {t.workspaceDescription}
        </p>
      </div>
      <TutorWorkspace
        subjects={subjects}
        selected={subject}
        mock={getEnv().LLM_PROVIDER === "mock"}
      />
    </LearningShell>
  );
}
