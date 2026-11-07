import Link from "next/link";
import { requireUser } from "@/lib/auth/server";
import { workspaceHref } from "@/lib/auth/roles";
import { ReviewLink } from "@/components/review/link";
import { rolesRu as t, authRu, tutorRu } from "@/lib/i18n/ru";
export async function WorkspaceNav() {
  const user = await requireUser();
  return (
    <nav
      className="mx-auto flex max-w-6xl flex-wrap gap-x-5 gap-y-2 px-5 pt-7 text-sm text-emerald-800"
      aria-label={t.workspace}
    >
      <Link
        href={workspaceHref(user.role)}
        className="inline-flex min-h-11 items-center underline"
      >
        {t.roles[user.role]}
      </Link>
      {user.role !== "USER" && (
        <Link
          href="/student"
          className="inline-flex min-h-11 items-center underline"
        >
          {t.myLearning}
        </Link>
      )}
      <Link
        href="/subjects"
        className="inline-flex min-h-11 items-center underline"
      >
        {t.catalog}
      </Link>
      <Link
        href="/cabinet/profile"
        className="inline-flex min-h-11 items-center underline"
      >
        {t.profile}
      </Link>
      <ReviewLink />
      <Link
        href="/tutor"
        className="inline-flex min-h-11 items-center underline"
      >
        {tutorRu.title}
      </Link>
      <form method="POST" action="/api/auth/logout">
        <button className="min-h-11 underline">{authRu.logout}</button>
      </form>
    </nav>
  );
}
