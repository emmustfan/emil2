import { getEnv } from "@/lib/env";
import { billingContent } from "@/lib/billing/config";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { formatPrice } from "@/lib/lessons/catalog";
export async function LandingPlans({ note }: { note: string }) {
  const billing = await billingContent();
  const plans = await getDb().plan.findMany({
    where: { isActive: true },
    orderBy: [{ order: "asc" }, { code: "asc" }],
  });
  return (
    <section id="plans" className="scroll-mt-8 py-12">
      <h2 className="text-3xl font-semibold">Тарифы</h2>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-600">
        {getEnv().PAYMENTS_PROVIDER === "mock" ? billing.mockNotice : note}
      </p>
      <div className="mt-7 grid gap-5 md:grid-cols-3">
        {plans.map((plan) => (
          <article
            key={plan.code}
            className="flex flex-col rounded-2xl border border-stone-200 bg-white p-6"
          >
            <h3 className="text-xl font-semibold">{plan.title}</h3>
            <p className="mt-5 text-2xl font-semibold">
              {formatPrice(plan.priceKopecks)}
              <span className="text-sm font-normal">
                {plan.kind === "FREE"
                  ? " · без оплаты"
                  : ` / ${plan.periodMonths} мес.`}
              </span>
            </p>
            <ul className="my-6 flex-1 space-y-3 text-sm text-stone-600">
              {plan.features.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
            <Link
              href={
                plan.kind === "FREE"
                  ? "/demo?source=landing"
                  : `/pricing?plan=${plan.code}`
              }
              className="lesson-primary"
            >
              {plan.kind === "FREE" ? "Попробовать бесплатно" : "Выбрать тариф"}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
