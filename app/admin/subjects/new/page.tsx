import { requireEditor } from "@/lib/auth/server";
import { SubjectForm } from "@/components/admin/subject-form";
import { contentRu as t } from "@/lib/i18n/ru";
export default async function NewSubject() {
  await requireEditor();
  return (
    <main className="mx-auto max-w-3xl">
      <h1 className="mb-7 text-3xl font-semibold">{t.newSubject}</h1>
      <div className="rounded-2xl border border-stone-200 bg-white p-6">
        <SubjectForm />
      </div>
    </main>
  );
}
