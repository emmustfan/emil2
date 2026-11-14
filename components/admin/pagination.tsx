import Link from "next/link";
import { contentRu as t } from "@/lib/i18n/ru";
export function Pagination({
  base,
  q,
  page,
  pages,
  total,
  filters = {},
}: {
  base: string;
  q: string;
  page: number;
  pages: number;
  total: number;
  filters?: Record<string, string>;
}) {
  const href = (next: number) =>
    `${base}?${new URLSearchParams({ ...filters, q, page: String(next) })}`;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-5 text-sm">
      <p className="text-stone-500">
        {t.total}: {total} · {t.page} {page} {t.of} {pages}
      </p>
      {page > 1 && (
        <Link
          className="inline-flex min-h-11 items-center text-emerald-800 underline"
          href={href(page - 1)}
        >
          {t.previous}
        </Link>
      )}
      {page < pages && (
        <Link
          className="inline-flex min-h-11 items-center text-emerald-800 underline"
          href={href(page + 1)}
        >
          {t.next}
        </Link>
      )}
    </div>
  );
}
