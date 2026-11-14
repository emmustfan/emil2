import Link from "next/link";
import { requireAdmin } from "@/lib/auth/server";
import { configuration } from "@/lib/admin/settings";
import { Configuration } from "@/components/admin/configuration";
export const dynamic = "force-dynamic";
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const actor = await requireAdmin(),
    p = await searchParams,
    section = ["plans", "limits", "texts", "legal"].includes(p.section ?? "")
      ? p.section!
      : "plans",
    data = await configuration(actor.id);
  return (
    <main>
      <h1 className="text-3xl font-semibold">Настройки платформы</h1>
      <nav className="my-6 flex flex-wrap gap-5" aria-label="Разделы настроек">
        {[
          ["plans", "Тарифы"],
          ["limits", "Лимиты"],
          ["texts", "Тексты и FAQ"],
          ["legal", "Юридические документы"],
        ].map(([key, title]) => (
          <Link
            key={key}
            href={`/admin/settings?section=${key}`}
            aria-current={key === section ? "page" : undefined}
            className="inline-flex min-h-11 items-center text-emerald-800 underline"
          >
            {title}
          </Link>
        ))}
      </nav>
      <Configuration key={section} data={data} section={section} />
    </main>
  );
}
