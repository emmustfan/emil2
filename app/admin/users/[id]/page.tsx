import Link from "next/link";
import { requireAdmin } from "@/lib/auth/server";
import { getManagedUser } from "@/lib/admin/users";
import { contentPage } from "@/lib/content/page";
import { UserAccessForm } from "@/components/admin/user-access-form";
import { rolesRu as t } from "@/lib/i18n/ru";
import { dayWindow } from "@/lib/srs/day";
export default async function UserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireAdmin(),
    { id } = await params,
    data = await contentPage(() => getManagedUser(actor.id, id));
  return (
    <main className="mx-auto max-w-3xl">
      <Link
        href="/admin/users"
        className="inline-flex min-h-11 items-center text-sm text-emerald-800 underline"
      >
        ← {t.backUsers}
      </Link>
      <h1 className="mt-4 text-3xl font-semibold break-words">
        {data.user.name || data.user.email || t.identity}
      </h1>
      <UserAccessForm
        timeZone={dayWindow(new Date(), actor.timezone).timeZone}
        key={data.user.id}
        initial={data}
        actorId={actor.id}
      />
    </main>
  );
}
