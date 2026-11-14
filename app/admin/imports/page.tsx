import type { Metadata } from "next";
import { requireEditor } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { listImports } from "@/lib/imports/service";
import { importLimits } from "@/lib/imports/policy";
import { ImportWorkspace } from "@/components/admin/import-workspace";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Импорт материалов",
  robots: { index: false, follow: false },
};
export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireEditor(),
    query = await searchParams;
  const subjects = await getDb().subject.findMany({
    where:
      user.role === "EDITOR"
        ? { teachingAssignments: { some: { teacherId: user.id } } }
        : {},
    select: {
      id: true,
      title: true,
      section_subjectId: {
        select: { id: true, title: true },
        orderBy: { order: "asc" },
      },
    },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });
  const [jobs, limits] = await Promise.all([
    listImports(user.id),
    importLimits(),
  ]);
  return (
    <main>
      <h1 className="text-3xl font-semibold">Импорт материалов</h1>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-stone-600">
        Загрузите учебный источник, чтобы подготовить методичку с пропусками и
        вопросы. Каждый результат нужно отредактировать и проверить экспертом
        перед публикацией.
      </p>
      <ImportWorkspace
        subjects={subjects.map((s) => ({
          id: s.id,
          title: s.title,
          sections: s.section_subjectId,
        }))}
        initial={jobs}
        initialSubject={
          typeof query.subjectId === "string" ? query.subjectId : undefined
        }
        maxBytes={limits.maxBytes}
        timeZone={user.timezone}
        mock={process.env.LLM_PROVIDER === "mock" || !process.env.LLM_PROVIDER}
      />
    </main>
  );
}
