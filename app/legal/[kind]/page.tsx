import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { AuthShell } from "@/components/auth/shell";
import { authRu } from "@/lib/i18n/ru";
import { LegalEntity } from "@/components/legal/entity";
export const dynamic = "force-dynamic";
export default async function Legal({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind } = await params;
  if (!Object.hasOwn(authRu.legalTitles, kind)) notFound();
  const document = await getDb().legalDocument.findFirst({
    where: { kind, publishedAt: { lte: new Date() } },
    orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
  });
  if (!document) notFound();
  return (
    <AuthShell
      title={authRu.legalTitles[kind as keyof typeof authRu.legalTitles]}
    >
      <p className="mb-5 text-xs text-stone-500">{document.version}</p>
      <div className="whitespace-pre-wrap text-sm leading-7">
        {document.contentMd}
      </div>
      <LegalEntity />
    </AuthShell>
  );
}
