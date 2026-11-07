import { ReviewLink } from "@/components/review/link";
import Link from "next/link";
import { requireUser } from "@/lib/auth/server";
import { authRu } from "@/lib/i18n/ru";
export default async function CabinetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return (
    <>
      <nav
        className="mx-auto flex max-w-2xl flex-wrap gap-5 px-5 pt-8 text-sm text-emerald-800"
        aria-label={authRu.cabinet}
      >
        <Link
          className="inline-flex min-h-11 items-center underline"
          href="/cabinet"
        >
          {authRu.cabinet}
        </Link>
        <Link
          className="inline-flex min-h-11 items-center underline"
          href="/cabinet/profile"
        >
          {authRu.profile}
        </Link>
        <ReviewLink />
        <form method="POST" action="/api/auth/logout">
          <button className="min-h-11 cursor-pointer underline">
            {authRu.logout}
          </button>
        </form>
      </nav>
      {children}
    </>
  );
}
