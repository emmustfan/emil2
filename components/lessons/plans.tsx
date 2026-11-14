import { getEnv } from "@/lib/env";
import { billingContent } from "@/lib/billing/config";
import Link from "next/link";
import { plans, formatPrice } from "@/lib/lessons/catalog";
export async function SubjectPlans({ subjectSlug }: { subjectSlug: string }) {
  const rows = await plans(),
    content = await billingContent();
  return (
    <section id="plans" className="mt-12 border-t border-stone-200 pt-10">
      <h2 className="text-2xl font-semibold">Доступ к материалам</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {rows.map((p) => (
          <article
            key={p.code}
            className="rounded-2xl border border-stone-200 bg-white p-6"
          >
            <h3 className="font-semibold">{p.title}</h3>
            <p className="mt-3 text-2xl font-semibold">
              {formatPrice(p.priceKopecks)}
              <span className="text-sm font-normal text-stone-500">
                {" "}
                / {p.periodMonths === 1 ? "мес" : `${p.periodMonths} мес`}
              </span>
            </p>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-stone-600">
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <Link
              className="lesson-primary mt-5"
              href={`/pricing?plan=${p.code}${p.kind === "SUBJECT" ? `&subject=${encodeURIComponent(subjectSlug)}` : ""}`}
            >
              Выбрать тариф
            </Link>
          </article>
        ))}
      </div>
      <p className="mt-5 text-sm leading-7 text-stone-600">
        {getEnv().PAYMENTS_PROVIDER === "mock"
          ? content.mockNotice
          : content.renewal}
      </p>
      <Link
        href={`/subjects/${subjectSlug}`}
        className="inline-flex min-h-11 items-center text-sm text-emerald-800 underline"
      >
        К темам предмета
      </Link>
    </section>
  );
}
