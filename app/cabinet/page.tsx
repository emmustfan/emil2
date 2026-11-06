import Link from "next/link";
import { requireUser } from "@/lib/auth/server";
import { AuthShell } from "@/components/auth/shell";
import { authRu } from "@/lib/i18n/ru";
export default async function Cabinet() {
  const user = await requireUser();
  return (
    <AuthShell title={authRu.cabinetTitle} description={authRu.cabinetText}>
      <Link href="/subjects" className="mr-5 text-emerald-800 underline">
        Предметы и уроки
      </Link>
      <Link href="/cabinet/profile" className="text-emerald-800 underline">
        {authRu.profile}
      </Link>
      {["ADMIN", "EDITOR"].includes(user.role) && (
        <Link href="/admin" className="ml-5 text-emerald-800 underline">
          {authRu.admin}
        </Link>
      )}
    </AuthShell>
  );
}
